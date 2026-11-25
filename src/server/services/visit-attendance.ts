import { getConfig } from "../config.js";
import { withTransaction, type Db } from "../db/transaction.js";
import { ConflictError, NotFoundError } from "../errors.js";
import { cancelApprovedAdoptionsBySystem, releaseReservedPet, selectNotSelectedAdopters, voidPendingAdoptions } from "../models/adoptions.js";
import { completeConfirmedVisits, expirePendingVisits, lockVisit, markVisitNoShow, voidOpenVisits, type ChangedVisit } from "../models/visits.js";
import { audit } from "./audit.js";
import { createNotification } from "./notifications.js";

const HOUR = 60 * 60 * 1000;

async function auditBySystem(db: Db, visit: ChangedVisit, after: Record<string, unknown>): Promise<void> {
  await audit(db, {
    actorUserId: null,
    action: `VISIT_${String(after["status"])}`,
    entityType: "Visit",
    entityId: visit.id,
    details: { before: { status: visit.previousStatus }, after },
  });
}

/**
 * CU-45, RN-95 (scheduled job): requests not answered within the deadline become EXPIRED,
 * which frees their place (RN-82), and the adopter is told. Idempotent. Returns how many.
 */
export async function expireUnansweredVisits(): Promise<number> {
  return withTransaction(async (client) => {
    const expired = await expirePendingVisits(client, getConfig().rules.visitResponseDeadlineHours);
    for (const visit of expired) {
      await createNotification(client, {
        userId: visit.adopterId,
        type: "VISIT_EXPIRED",
        params: { petName: visit.petName, startsAt: visit.startsAt },
        link: { visitId: visit.id },
      });
      await auditBySystem(client, visit, { status: "EXPIRED" });
    }
    return expired.length;
  });
}

/**
 * CU-46, RN-106, RN-107 (scheduled job): confirmed visits whose slot ended the configured
 * hours ago without a no-show become COMPLETED, marked by the system. Idempotent.
 */
export async function completePastVisits(): Promise<number> {
  return withTransaction(async (client) => {
    const completed = await completeConfirmedVisits(client, getConfig().rules.visitAutoCompleteHours);
    for (const visit of completed) await auditBySystem(client, visit, { status: "COMPLETED", attendanceMarkedBy: "SYSTEM" });
    return completed.length;
  });
}

/**
 * RN-103: after a no-show the adopter loses the right to visit and adopt at that shelter:
 * their open visits and pending adoptions there are voided, and an approved adoption is
 * cancelled by the system, so its pet is available again and the not-selected adopters are told.
 */
async function applyNoShowConsequences(db: Db, adopterId: number, shelterId: number): Promise<void> {
  for (const visit of await voidOpenVisits(db, adopterId, shelterId, "NO_SHOW")) {
    // RN-110
    await createNotification(db, {
      userId: adopterId,
      type: "VISIT_VOIDED_NO_SHOW",
      params: { petName: visit.petName, startsAt: visit.startsAt },
      link: { visitId: visit.id },
    });
    await auditBySystem(db, visit, { status: "VOIDED", voidReason: "NO_SHOW" });
  }

  for (const adoption of await voidPendingAdoptions(db, adopterId, shelterId, "NO_SHOW")) {
    await createNotification(db, { userId: adopterId, type: "ADOPTION_VOIDED_NO_SHOW", params: { petName: adoption.petName }, link: { adoptionId: adoption.id } });
    await audit(db, {
      actorUserId: null,
      action: "ADOPTION_VOIDED",
      entityType: "Adoption",
      entityId: adoption.id,
      details: { before: { status: "PENDING" }, after: { status: "VOIDED", voidReason: "NO_SHOW" } },
    });
  }

  for (const adoption of await cancelApprovedAdoptionsBySystem(db, adopterId, shelterId)) {
    await createNotification(db, { userId: adopterId, type: "ADOPTION_CANCELLED_NO_SHOW", params: { petName: adoption.petName }, link: { adoptionId: adoption.id } });
    await audit(db, {
      actorUserId: null,
      action: "ADOPTION_CANCELLED",
      entityType: "Adoption",
      entityId: adoption.id,
      details: { before: { status: "APPROVED" }, after: { status: "CANCELLED", cancelledBy: "SYSTEM" } },
    });
    if (await releaseReservedPet(db, adoption.petId)) {
      await audit(db, {
        actorUserId: null,
        action: "PET_STATUS_CHANGED",
        entityType: "Pet",
        entityId: adoption.petId,
        details: { before: { status: "RESERVED" }, after: { status: "AVAILABLE" } },
      });
      for (const userId of await selectNotSelectedAdopters(db, adoption.petId)) {
        await createNotification(db, { userId, type: "PET_AVAILABLE_AGAIN", params: { petName: adoption.petName }, link: { petId: adoption.petId } });
      }
    }
  }
}

/**
 * CU-26, RN-102, RN-104, RN-105: the shelter registers that the adopter did not come to a
 * confirmed visit, after it ended and before the configured hours pass (then it already
 * counts as completed, RN-106). One transaction with all its consequences (RN-103, RN-171).
 */
export async function registerNoShow(shelterId: number, visitId: number): Promise<{ id: number; status: "NO_SHOW" }> {
  const hours = getConfig().rules.visitAutoCompleteHours;
  const tooLate = `Han pasado más de ${String(hours)} horas desde la visita: ya cuenta como realizada.`;
  return withTransaction(async (client) => {
    const visit = await lockVisit(client, visitId, { shelterId });
    if (!visit) throw new NotFoundError("La visita no existe.");
    if (visit.status === "COMPLETED") throw new ConflictError(tooLate);
    if (visit.status !== "CONFIRMED") throw new ConflictError("La visita no está confirmada.");
    const now = Date.now();
    if (visit.endsAt.getTime() > now) throw new ConflictError("La visita todavía no ha tenido lugar.");
    if (visit.endsAt.getTime() + hours * HOUR <= now) throw new ConflictError(tooLate);

    await markVisitNoShow(client, visitId);
    await audit(client, {
      actorUserId: shelterId,
      action: "VISIT_NO_SHOW",
      entityType: "Visit",
      entityId: visitId,
      details: { before: { status: "CONFIRMED" }, after: { status: "NO_SHOW" } },
    });
    await applyNoShowConsequences(client, visit.adopterId, shelterId);
    return { id: visitId, status: "NO_SHOW" };
  });
}
