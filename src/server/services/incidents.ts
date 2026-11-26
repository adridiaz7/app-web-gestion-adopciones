import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import { BadRequestError, ConflictError, NotFoundError } from "../errors.js";
import {
  insertIncident,
  isAdoptionBetween,
  isVisitBetween,
  lockIncident,
  selectActiveRole,
  selectIncidents,
  updateIncidentStatus,
  type IncidentForAdmin,
  type IncidentReason,
  type IncidentStatus,
} from "../models/incidents.js";
import { correctNoShow, visitExists } from "../models/visits.js";
import { audit } from "./audit.js";
import { createNotification } from "./notifications.js";

export type { IncidentReason };

export interface NewIncident {
  reportedId: number;
  reason: IncidentReason;
  /** Already trimmed and not empty (RN-167). */
  description: string;
  visitId: number | null;
  adoptionId: number | null;
}

/**
 * CU-36: an adopter or a shelter reports the other side to the administrator (RN-165), with
 * a reason and an explanation (RN-167), optionally about one visit or adoption between them
 * (RN-166). It starts OPEN (RN-168). RN-170: the reported user is not told.
 */
export async function openIncident(reporter: { id: number; role: "ADOPTER" | "SHELTER" }, input: NewIncident): Promise<{ id: number; status: "OPEN" }> {
  return withTransaction(async (client) => {
    const otherSide = reporter.role === "ADOPTER" ? "SHELTER" : "ADOPTER";
    if ((await selectActiveRole(client, input.reportedId)) !== otherSide) {
      throw new NotFoundError(otherSide === "SHELTER" ? "La protectora no existe." : "El adoptante no existe.");
    }

    const adopterId = reporter.role === "ADOPTER" ? reporter.id : input.reportedId;
    const shelterId = reporter.role === "SHELTER" ? reporter.id : input.reportedId;
    const linked =
      (input.visitId === null || (await isVisitBetween(client, input.visitId, adopterId, shelterId))) &&
      (input.adoptionId === null || (await isAdoptionBetween(client, input.adoptionId, adopterId, shelterId)));
    if (!linked) throw new BadRequestError("La visita o adopción indicada no es entre vosotros.");

    const id = await insertIncident(client, { reporterId: reporter.id, ...input });
    return { id, status: "OPEN" };
  });
}

export type { IncidentForAdmin, IncidentStatus };

/** CU-37: the incidents for the administrator, optionally with one status. */
export async function listIncidents(status: IncidentStatus | null): Promise<IncidentForAdmin[]> {
  return selectIncidents(getPool(), status);
}

/**
 * CU-37, RN-168: the administrator moves an incident to IN_REVIEW, or closes it (RESOLVED or
 * DISMISSED) with its resolution. RN-169: the reporter is told when it is closed; RN-170: the
 * other party is not (no resolution here affects them). Audited (RN-208).
 */
export async function changeIncidentStatus(adminId: number, id: number, status: "IN_REVIEW" | "RESOLVED" | "DISMISSED", resolution: string | null): Promise<void> {
  await withTransaction(async (client) => {
    const incident = await lockIncident(client, id);
    if (!incident) throw new NotFoundError("La incidencia no existe.");
    if (incident.status === "RESOLVED" || incident.status === "DISMISSED") throw new ConflictError("La incidencia ya está cerrada.");

    await updateIncidentStatus(client, id, status, status === "IN_REVIEW" ? null : resolution);
    await audit(client, {
      actorUserId: adminId,
      action: "INCIDENT_STATUS_CHANGED",
      entityType: "Incident",
      entityId: id,
      details: { before: { status: incident.status }, after: status === "IN_REVIEW" ? { status } : { status, resolution } },
    });
    if (status !== "IN_REVIEW" && resolution !== null) {
      await createNotification(client, {
        userId: incident.reporterId,
        type: status === "RESOLVED" ? "INCIDENT_RESOLVED" : "INCIDENT_DISMISSED",
        params: { resolution },
        link: { incidentId: id },
      });
    }
  });
}

/** CU-38, RN-108: the administrator corrects a NO_SHOW visit to COMPLETED; recorded as done by the administrator. */
export async function correctAttendance(adminId: number, visitId: number): Promise<{ id: number; status: "COMPLETED" }> {
  return withTransaction(async (client) => {
    if (!(await correctNoShow(client, visitId))) {
      if (!(await visitExists(client, visitId))) throw new NotFoundError("La visita no existe.");
      throw new ConflictError("La visita no está marcada como no asistida.");
    }
    await audit(client, {
      actorUserId: adminId,
      action: "VISIT_ATTENDANCE_CORRECTED",
      entityType: "Visit",
      entityId: visitId,
      details: { before: { status: "NO_SHOW" }, after: { status: "COMPLETED", attendanceMarkedBy: "ADMIN" } },
    });
    return { id: visitId, status: "COMPLETED" };
  });
}
