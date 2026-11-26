import { getPool } from "../db/pool.js";
import { withTransaction, type Db } from "../db/transaction.js";
import { ConflictError, NotFoundError } from "../errors.js";
import { voidOpenAdoptionsOf, voidOpenVisitsOf } from "../models/account-deletion.js";
import { releaseReservedPet, selectNotSelectedAdopters } from "../models/adoptions.js";
import { deleteUserSessions } from "../models/sessions.js";
import {
  cancelAdopterApprovedAdoptions,
  endActiveSuspension,
  insertSuspensionIfNoneActive,
  lockSuspendableUser,
  selectAdminUsers,
  type AdminUserRow,
  type Suspension,
  type SuspensionReason,
} from "../models/suspensions.js";
import { audit } from "./audit.js";
import { createNotification } from "./notifications.js";
import { alertPetAvailable, alertShelterPets } from "./pet-alerts.js";

export type { AdminUserRow, Suspension, SuspensionReason };

const NOT_FOUND = "La cuenta no existe.";

/** CU-40: the accounts the administrator can suspend or reactivate. */
export async function listAdminUsers(query: string): Promise<AdminUserRow[]> {
  return selectAdminUsers(getPool(), query);
}

/**
 * RN-158: the adopter's open visits and pending adoptions become VOIDED (ADOPTER_SUSPENDED),
 * and an approved adoption is cancelled by the system: its pet is available again and the
 * not-selected adopters are told. The adopter is told of each change (RN-110).
 */
async function applyAdopterSuspension(db: Db, adminId: number, adopterId: number): Promise<void> {
  for (const visit of await voidOpenVisitsOf(db, "adopter_id", adopterId, "ADOPTER_SUSPENDED")) {
    await createNotification(db, {
      userId: adopterId,
      type: "VISIT_VOIDED_ADOPTER_SUSPENDED",
      params: { petName: visit.petName, startsAt: visit.startsAt },
      link: { visitId: visit.id },
    });
    await audit(db, {
      actorUserId: adminId,
      action: "VISIT_VOIDED",
      entityType: "Visit",
      entityId: visit.id,
      details: { before: { status: visit.previousStatus }, after: { status: "VOIDED", voidReason: "ADOPTER_SUSPENDED" } },
    });
  }
  for (const adoption of await voidOpenAdoptionsOf(db, "adopter_id", adopterId, "ADOPTER_SUSPENDED", ["PENDING"])) {
    await createNotification(db, { userId: adopterId, type: "ADOPTION_VOIDED_ADOPTER_SUSPENDED", params: { petName: adoption.petName }, link: { adoptionId: adoption.id } });
    await audit(db, {
      actorUserId: adminId,
      action: "ADOPTION_VOIDED",
      entityType: "Adoption",
      entityId: adoption.id,
      details: { before: { status: "PENDING" }, after: { status: "VOIDED", voidReason: "ADOPTER_SUSPENDED" } },
    });
  }
  for (const adoption of await cancelAdopterApprovedAdoptions(db, adopterId)) {
    await createNotification(db, { userId: adopterId, type: "ADOPTION_CANCELLED_ADOPTER_SUSPENDED", params: { petName: adoption.petName }, link: { adoptionId: adoption.id } });
    await audit(db, {
      actorUserId: adminId,
      action: "ADOPTION_CANCELLED",
      entityType: "Adoption",
      entityId: adoption.id,
      details: { before: { status: "APPROVED" }, after: { status: "CANCELLED", cancelledBy: "SYSTEM" } },
    });
    if (await releaseReservedPet(db, adoption.petId)) {
      await audit(db, {
        actorUserId: adminId,
        action: "PET_STATUS_CHANGED",
        entityType: "Pet",
        entityId: adoption.petId,
        details: { before: { status: "RESERVED" }, after: { status: "AVAILABLE" } },
      });
      const notSelected = await selectNotSelectedAdopters(db, adoption.petId);
      for (const userId of notSelected) {
        await createNotification(db, { userId, type: "PET_AVAILABLE_AGAIN", params: { petName: adoption.petName }, link: { petId: adoption.petId } });
      }
      // RN-199, RN-200: the adopter of this adoption and the candidates were already told
      await alertPetAvailable(db, adoption.petId, [adopterId, ...notSelected]);
    }
  }
}

/**
 * CU-40, RN-154 to RN-158: the administrator suspends an adopter or a shelter with a reason.
 * Its sessions are closed so it cannot keep using the app (RN-154). A shelter keeps what is in
 * progress (RN-157) and its pets stop being visible (RN-23). One transaction, audited (RN-208).
 */
export async function suspendUser(adminId: number, userId: number, reason: SuspensionReason, detail: string | null): Promise<Suspension> {
  return withTransaction(async (client) => {
    const user = await lockSuspendableUser(client, userId);
    if (!user) throw new NotFoundError(NOT_FOUND);
    const suspension = await insertSuspensionIfNoneActive(client, userId, reason, detail);
    if (!suspension) throw new ConflictError("Esta cuenta ya está suspendida.");
    await audit(client, {
      actorUserId: adminId,
      action: "ACCOUNT_SUSPENDED",
      entityType: "Suspension",
      entityId: suspension.id,
      details: { after: { userId, reason, detail } },
    });
    await deleteUserSessions(client, userId);
    if (user.role === "ADOPTER") await applyAdopterSuspension(client, adminId, userId);
    return suspension;
  });
}

/**
 * CU-40, RN-156: the administrator ends the active suspension; it stays in the history. Audited
 * (RN-208). A shelter's available pets are visible again (RN-23), so they are announced (RN-199).
 */
export async function reactivateUser(adminId: number, userId: number): Promise<void> {
  await withTransaction(async (client) => {
    const user = await lockSuspendableUser(client, userId);
    if (!user) throw new NotFoundError(NOT_FOUND);
    const id = await endActiveSuspension(client, userId);
    if (id === null) throw new ConflictError("Esta cuenta no está suspendida.");
    await audit(client, { actorUserId: adminId, action: "ACCOUNT_REACTIVATED", entityType: "Suspension", entityId: id, details: { before: { endedAt: null }, after: { userId } } });
    if (user.role === "SHELTER") await alertShelterPets(client, userId);
  });
}
