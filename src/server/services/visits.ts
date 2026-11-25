import { getConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { withTransaction, type Db } from "../db/transaction.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors.js";
import { selectVisiblePet } from "../models/gallery.js";
import { selectActiveBlock } from "../models/shelter-search.js";
import { countOccupied, lockShelterSlot } from "../models/visit-slots.js";
import {
  ensureConversation,
  hasNoShow,
  insertVisit,
  lockPetForRequest,
  lockVisit,
  markVisitCancelled,
  markVisitConfirmed,
  markVisitRejected,
  petHasActiveVisit,
  selectAdopterQuotas,
  selectAdopterVisits,
  selectAvailableSlots,
  selectPendingRequests,
  selectQuotaVisitEnds,
  selectRequestedVisit,
  selectUpcomingVisits,
  type AdopterVisit,
  type AvailableSlot,
  type InboxVisit,
  type RequestedVisit,
  type VisitForChange,
  type VisitStatus,
} from "../models/visits.js";
import { audit } from "./audit.js";
import { createNotification } from "./notifications.js";
import { remindDueVisits } from "./visit-reminders.js";

export type { AdopterVisit, AvailableSlot, InboxVisit, RequestedVisit };

const PET_NOT_AVAILABLE = "Esta mascota no está disponible.";
const HOUR = 60 * 60 * 1000;
const madridDay = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long", year: "numeric" });

/** RN-194: the slots the adopter can choose for a pet visible to them (same visibility as its profile). */
export async function listAvailableSlots(adopterId: number, petId: number): Promise<AvailableSlot[]> {
  const pool = getPool();
  const pet = await selectVisiblePet(pool, adopterId, petId);
  if (!pet) throw new NotFoundError(PET_NOT_AVAILABLE);
  return selectAvailableSlots(pool, pet.shelter.id, petId, getConfig().rules.visitMinNoticeHours);
}

/**
 * CU-23: requests a visit to a pet in one of its shelter's slots. It stays PENDING until the
 * shelter answers. The first request to a shelter opens the conversation (RN-134). One
 * transaction (RN-171), audited (RN-208).
 */
export async function requestVisit(adopterId: number, petId: number, slotId: number): Promise<RequestedVisit> {
  return withTransaction(async (client) => insertCheckedRequest(client, adopterId, petId, slotId, null));
}

/**
 * Checks every rule of a visit request (CU-23) and creates it PENDING, inside the caller's
 * transaction. Also used by a reschedule (RN-196), with the visit it replaces.
 */
async function insertCheckedRequest(
  client: Db,
  adopterId: number,
  petId: number,
  slotId: number,
  replacesVisitId: number | null,
): Promise<RequestedVisit> {
  const rules = getConfig().rules;
  const pet = await lockPetForRequest(client, petId);
  if (!pet?.shelterVisible) throw new NotFoundError(PET_NOT_AVAILABLE);

  // RN-88: same neutral text as the notice on the shelter's profile (RN-149).
  const block = await selectActiveBlock(client, pet.shelterId, adopterId);
  if (block) {
    const until = block.endsAt ? ` hasta el ${madridDay.format(block.endsAt)}` : "";
    throw new ForbiddenError(`La protectora ${pet.shelterName} ha restringido tu acceso a sus mascotas${until}.`);
  }
  // RN-86
  if (pet.status !== "AVAILABLE") throw new ConflictError(PET_NOT_AVAILABLE);
  // RN-89, RN-102
  if (await hasNoShow(client, adopterId, pet.shelterId)) {
    throw new ForbiddenError("No puedes solicitar más visitas en esta protectora porque no acudiste a una visita confirmada.");
  }

  // RN-83: the slot is one of the pet's shelter. Locked, so two requests cannot take the last place.
  const slot = await lockShelterSlot(client, pet.shelterId, slotId);
  if (!slot) throw new NotFoundError("El turno no existe.");
  // RN-87
  if (slot.startsAt.getTime() < Date.now() + rules.visitMinNoticeHours * HOUR) {
    throw new ConflictError(`La visita se tiene que solicitar con al menos ${String(rules.visitMinNoticeHours)} horas de antelación.`);
  }
  // RN-82
  if ((await countOccupied(client, slotId)) >= slot.capacity) throw new ConflictError("Este turno ya no tiene plazas libres.");
  // RN-81
  if (await petHasActiveVisit(client, petId, slotId)) throw new ConflictError("Esta mascota ya tiene una visita en este turno. Elige otro.");

  // RN-90, RN-91, RN-92; RN-93: tell when the next place frees up.
  const counted = await selectQuotaVisitEnds(client, adopterId, pet.shelterId, rules.visitQuotaWindowMonths);
  if (counted.length >= rules.visitQuotaPerShelter) {
    const freedBy = counted[counted.length - rules.visitQuotaPerShelter];
    const from = freedBy ? ` Podrás solicitar otra a partir del ${madridDay.format(freedBy)}.` : "";
    throw new ConflictError(
      `Ya tienes ${String(rules.visitQuotaPerShelter)} visitas confirmadas o realizadas en esta protectora en los últimos ${String(rules.visitQuotaWindowMonths)} meses.${from}`,
    );
  }

  const visitId = await insertVisit(client, adopterId, pet.shelterId, petId, slotId, replacesVisitId);
  await ensureConversation(client, adopterId, pet.shelterId);
  await audit(client, {
    actorUserId: adopterId,
    action: "VISIT_REQUESTED",
    entityType: "Visit",
    entityId: visitId,
    details: { after: replacesVisitId === null ? { status: "PENDING" } : { status: "PENDING", replacesVisitId } },
  });

  const visit = await selectRequestedVisit(client, visitId);
  if (!visit) throw new Error("visit not found after creating it");
  return visit;
}

/**
 * CU-51, RN-195, RN-196: the adopter moves a pending or confirmed visit, with the same notice
 * as a cancellation (RN-97), to another slot of the shelter for the same pet. In one
 * transaction (RN-171) the original is cancelled by the adopter and a new PENDING request is
 * made with every rule of CU-23; if the new request is not valid, everything rolls back and
 * the original is left as it was. The shelter is notified.
 */
export async function rescheduleVisit(adopterId: number, visitId: number, slotId: number): Promise<RequestedVisit> {
  return withTransaction(async (client) => {
    const visit = await lockVisit(client, visitId, { adopterId });
    if (!visit) throw new NotFoundError(VISIT_NOT_FOUND);
    if (visit.status !== "PENDING" && visit.status !== "CONFIRMED") throw new ConflictError(CLOSED);
    const noticeHours = getConfig().rules.visitCancelMinNoticeHours;
    if (visit.startsAt.getTime() < Date.now() + noticeHours * HOUR) {
      throw new ConflictError(`Faltan menos de ${String(noticeHours)} horas para la visita: ya no se puede reprogramar.`);
    }
    if (visit.slotId === slotId) throw new ConflictError("Elige un turno distinto al de la visita actual.");

    await markVisitCancelled(client, visitId, "ADOPTER");
    await audit(client, {
      actorUserId: adopterId,
      action: "VISIT_CANCELLED",
      entityType: "Visit",
      entityId: visitId,
      details: { before: { status: visit.status }, after: { status: "CANCELLED", cancelledBy: "ADOPTER", rescheduled: true } },
    });

    const requested = await insertCheckedRequest(client, adopterId, visit.petId, slotId, visitId);
    await createNotification(client, {
      userId: visit.shelterId,
      type: "VISIT_RESCHEDULED",
      params: { petName: visit.petName, previousStartsAt: visit.startsAt, startsAt: requested.startsAt },
      link: { visitId: requested.id },
    });
    return requested;
  });
}

const VISIT_NOT_FOUND = "La visita no existe.";
const CLOSED = "La visita ya está cerrada.";

export interface VisitStatusResult {
  id: number;
  status: VisitStatus;
}

/**
 * Locks the visit of that adopter or shelter, applies `change` (which checks the rules and
 * updates it), and audits the change of status (RN-208), all in one transaction (RN-171).
 */
async function changeVisit(
  actorUserId: number,
  visitId: number,
  owner: { adopterId: number } | { shelterId: number },
  change: (client: Db, visit: VisitForChange) => Promise<{ status: VisitStatus; cancelledBy?: "ADOPTER" | "SHELTER" }>,
): Promise<VisitStatusResult> {
  return withTransaction(async (client) => {
    const visit = await lockVisit(client, visitId, owner);
    if (!visit) throw new NotFoundError(VISIT_NOT_FOUND);
    const after = await change(client, visit);
    await audit(client, {
      actorUserId,
      action: `VISIT_${after.status}`,
      entityType: "Visit",
      entityId: visitId,
      details: { before: { status: visit.status }, after },
    });
    return { id: visitId, status: after.status };
  });
}

/** CU-24 exceptions: only a PENDING request answered within the deadline (RN-94). */
function checkCanAnswer(visit: VisitForChange): void {
  if (visit.status === "CANCELLED") throw new ConflictError("El adoptante ya ha cancelado la solicitud.");
  if (visit.status !== "PENDING") throw new ConflictError("La visita no está pendiente de respuesta.");
  const deadlineHours = getConfig().rules.visitResponseDeadlineHours;
  if (Date.now() > visit.createdAt.getTime() + deadlineHours * HOUR) {
    throw new ConflictError(`La solicitud ha caducado: han pasado más de ${String(deadlineHours)} horas sin respuesta.`);
  }
}

/** CU-24: the shelter confirms a pending request; the adopter is notified. */
export async function confirmVisit(shelterId: number, visitId: number): Promise<VisitStatusResult> {
  return changeVisit(shelterId, visitId, { shelterId }, async (client, visit) => {
    checkCanAnswer(visit);
    await markVisitConfirmed(client, visitId);
    await createNotification(client, {
      userId: visit.adopterId,
      type: "VISIT_CONFIRMED",
      params: { petName: visit.petName, startsAt: visit.startsAt },
      link: { visitId },
    });
    // RN-197: if less than the reminder notice is left, the reminder goes out at once.
    await remindDueVisits(client, visitId);
    return { status: "CONFIRMED" };
  });
}

/** CU-24, RN-96: the shelter rejects a pending request, with an optional reason; the adopter is notified. */
export async function rejectVisit(shelterId: number, visitId: number, reason: string | null): Promise<VisitStatusResult> {
  return changeVisit(shelterId, visitId, { shelterId }, async (client, visit) => {
    checkCanAnswer(visit);
    await markVisitRejected(client, visitId, reason);
    await createNotification(client, {
      userId: visit.adopterId,
      type: "VISIT_REJECTED",
      params: { petName: visit.petName, startsAt: visit.startsAt, reason },
      link: { visitId },
    });
    return { status: "REJECTED" };
  });
}

/**
 * CU-25, RN-97, RN-98: the adopter cancels a pending or confirmed visit with 24 h or more
 * left. RN-101: recorded as cancelled by the adopter; the shelter is notified.
 */
export async function cancelVisitByAdopter(adopterId: number, visitId: number): Promise<VisitStatusResult> {
  return changeVisit(adopterId, visitId, { adopterId }, async (client, visit) => {
    if (visit.status !== "PENDING" && visit.status !== "CONFIRMED") throw new ConflictError(CLOSED);
    const noticeHours = getConfig().rules.visitCancelMinNoticeHours;
    if (visit.startsAt.getTime() < Date.now() + noticeHours * HOUR) {
      throw new ConflictError(`Faltan menos de ${String(noticeHours)} horas para la visita: ya no se puede cancelar.`);
    }
    await markVisitCancelled(client, visitId, "ADOPTER");
    await createNotification(client, {
      userId: visit.shelterId,
      type: "VISIT_CANCELLED_BY_ADOPTER",
      params: { petName: visit.petName, startsAt: visit.startsAt },
      link: { visitId },
    });
    return { status: "CANCELLED", cancelledBy: "ADOPTER" };
  });
}

/**
 * CU-25, RN-100: the shelter cancels a confirmed visit at any time (it does not count for the
 * adopter's quota, RN-92). RN-101: recorded as cancelled by the shelter; the adopter is notified.
 */
export async function cancelVisitByShelter(shelterId: number, visitId: number): Promise<VisitStatusResult> {
  return changeVisit(shelterId, visitId, { shelterId }, async (client, visit) => {
    if (visit.status === "PENDING") throw new ConflictError("La visita no está confirmada.");
    if (visit.status !== "CONFIRMED") throw new ConflictError(CLOSED);
    await markVisitCancelled(client, visitId, "SHELTER");
    await createNotification(client, {
      userId: visit.adopterId,
      type: "VISIT_CANCELLED_BY_SHELTER",
      params: { petName: visit.petName, startsAt: visit.startsAt },
      link: { visitId },
    });
    return { status: "CANCELLED", cancelledBy: "SHELTER" };
  });
}

/** CU-21, RN-89 to RN-91, RN-93: the quota at a shelter. */
export interface ShelterQuota {
  shelterId: number;
  shelterName: string;
  used: number;
  limit: number;
  /** RN-90: months of the moving window. */
  windowMonths: number;
  /** When the soonest place frees up, or null if no visit counts. */
  nextPlaceAt: Date | null;
  /** RN-89: a no-show there: no more visits at that shelter. */
  noShow: boolean;
}

/** CU-21: a visit of the adopter's list; RN-97, RN-98: whether they can still cancel it. */
export interface AdopterVisitItem extends AdopterVisit {
  canCancel: boolean;
}

/** CU-21: the adopter's visits and their quota at each shelter. */
export async function listAdopterVisits(adopterId: number): Promise<{ visits: AdopterVisitItem[]; quotas: ShelterQuota[] }> {
  const pool = getPool();
  const rules = getConfig().rules;
  const [visits, quotaRows] = await Promise.all([
    selectAdopterVisits(pool, adopterId),
    selectAdopterQuotas(pool, adopterId, rules.visitQuotaWindowMonths),
  ]);
  const quotas = quotaRows.map((row) => ({
    shelterId: row.shelterId,
    shelterName: row.shelterName,
    used: row.countsUntil.length,
    limit: rules.visitQuotaPerShelter,
    windowMonths: rules.visitQuotaWindowMonths,
    nextPlaceAt: row.countsUntil[0] ?? null,
    noShow: row.noShow,
  }));
  const cancelLimit = Date.now() + rules.visitCancelMinNoticeHours * HOUR;
  const items = visits.map((visit) => ({
    ...visit,
    canCancel: (visit.status === "PENDING" || visit.status === "CONFIRMED") && visit.startsAt.getTime() >= cancelLimit,
  }));
  return { visits: items, quotas };
}

/** CU-22: the shelter's pending requests (RN-94: still within the deadline) and upcoming confirmed visits. */
export async function getShelterInbox(shelterId: number): Promise<{ pending: InboxVisit[]; upcoming: InboxVisit[] }> {
  const pool = getPool();
  const [pending, upcoming] = await Promise.all([
    selectPendingRequests(pool, shelterId, getConfig().rules.visitResponseDeadlineHours),
    selectUpcomingVisits(pool, shelterId),
  ]);
  return { pending, upcoming };
}
