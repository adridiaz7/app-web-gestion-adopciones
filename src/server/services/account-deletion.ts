import { withTransaction, type Db } from "../db/transaction.js";
import { BadRequestError, ForbiddenError, UnauthorizedError } from "../errors.js";
import {
  anonymiseAdopter,
  anonymiseShelter,
  clearAuditIpAddresses,
  lockAccount,
  markAccountDeleted,
  selectProfileAuditDetails,
  unlistShelterPets,
  updateAuditDetails,
  voidOpenAdoptionsOf,
  voidOpenVisitsOf,
} from "../models/account-deletion.js";
import { releaseReservedPet, selectNotSelectedAdopters } from "../models/adoptions.js";
import { selectShelterName } from "../models/blocks.js";
import { deleteUserSessions } from "../models/sessions.js";
import { audit } from "./audit.js";
import { createNotification } from "./notifications.js";
import { alertFavorites, alertPetAvailable } from "./pet-alerts.js";
import { verifyPassword } from "./passwords.js";

/** RN-13: how a deleted account shows everywhere. */
const DELETED_NAME = "Usuario eliminado";

/** RN-210: keeps the keys of an audit entry, at any depth, and empties the values. */
export function emptyValues(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, emptyValues(inner)]));
}

/**
 * RN-12: the adopter's open visits and adoptions are voided, telling each shelter with one
 * notification per process, as "Usuario eliminado" (RN-210). An approved adoption frees its
 * pet for the other candidates, as when it is cancelled (RN-130).
 */
async function voidAdopterProcesses(db: Db, adopterId: number): Promise<void> {
  for (const visit of await voidOpenVisitsOf(db, "adopter_id", adopterId)) {
    await createNotification(db, {
      userId: visit.shelterId,
      type: "VISIT_VOIDED_ADOPTER_DELETED",
      params: { petName: visit.petName, startsAt: visit.startsAt },
      link: { visitId: visit.id },
    });
    await audit(db, {
      actorUserId: adopterId,
      action: "VISIT_VOIDED",
      entityType: "Visit",
      entityId: visit.id,
      details: { before: { status: visit.previousStatus }, after: { status: "VOIDED", voidReason: "ACCOUNT_DELETED" } },
    });
  }
  for (const adoption of await voidOpenAdoptionsOf(db, "adopter_id", adopterId)) {
    await createNotification(db, {
      userId: adoption.shelterId,
      type: "ADOPTION_VOIDED_ADOPTER_DELETED",
      params: { petName: adoption.petName },
      link: { adoptionId: adoption.id },
    });
    await audit(db, {
      actorUserId: adopterId,
      action: "ADOPTION_VOIDED",
      entityType: "Adoption",
      entityId: adoption.id,
      details: { before: { status: adoption.previousStatus }, after: { status: "VOIDED", voidReason: "ACCOUNT_DELETED" } },
    });
    if (adoption.previousStatus === "APPROVED" && (await releaseReservedPet(db, adoption.petId))) {
      await audit(db, {
        actorUserId: adopterId,
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
 * RN-12 and the decision of 26/11/2026: the shelter's open visits and adoptions are voided,
 * telling each adopter, and its available and reserved pets are unlisted. Adopted pets stay.
 */
async function closeShelterProcesses(db: Db, shelterId: number): Promise<void> {
  const shelterName = await selectShelterName(db, shelterId);
  for (const visit of await voidOpenVisitsOf(db, "shelter_id", shelterId)) {
    await createNotification(db, {
      userId: visit.adopterId,
      type: "VISIT_VOIDED_ACCOUNT_DELETED",
      params: { petName: visit.petName, startsAt: visit.startsAt, shelterName },
      link: { visitId: visit.id },
    });
    await audit(db, {
      actorUserId: shelterId,
      action: "VISIT_VOIDED",
      entityType: "Visit",
      entityId: visit.id,
      details: { before: { status: visit.previousStatus }, after: { status: "VOIDED", voidReason: "ACCOUNT_DELETED" } },
    });
  }
  const voided = await voidOpenAdoptionsOf(db, "shelter_id", shelterId);
  for (const adoption of voided) {
    await createNotification(db, {
      userId: adoption.adopterId,
      type: "ADOPTION_VOIDED_ACCOUNT_DELETED",
      params: { petName: adoption.petName, shelterName },
      link: { adoptionId: adoption.id },
    });
    await audit(db, {
      actorUserId: shelterId,
      action: "ADOPTION_VOIDED",
      entityType: "Adoption",
      entityId: adoption.id,
      details: { before: { status: adoption.previousStatus }, after: { status: "VOIDED", voidReason: "ACCOUNT_DELETED" } },
    });
  }
  for (const pet of await unlistShelterPets(db, shelterId)) {
    // RN-200: the adopters whose adoptions of this pet were just voided are already told
    const alreadyTold = voided.filter((adoption) => adoption.petId === pet.id).map((adoption) => adoption.adopterId);
    await alertFavorites(db, pet.id, "UNLISTED", alreadyTold);
    await audit(db, {
      actorUserId: shelterId,
      action: "PET_STATUS_CHANGED",
      entityType: "Pet",
      entityId: pet.id,
      details: { before: { status: pet.previousStatus }, after: { status: "UNLISTED", unlistReason: "ACCOUNT_DELETED" } },
    });
  }
}

/** RN-210: the values of the entries about the profile are emptied and the account's IP addresses removed. */
async function anonymiseAuditLog(db: Db, userId: number, profileType: "Adopter" | "Shelter"): Promise<void> {
  for (const entry of await selectProfileAuditDetails(db, userId, profileType)) {
    await updateAuditDetails(db, entry.id, emptyValues(entry.details) ?? {});
  }
  await clearAuditIpAddresses(db, userId);
}

/**
 * CU-07, RN-11 to RN-13, RN-210: an adopter or a shelter deletes their account, confirming it
 * with the current password (decision of 26/11/2026). The personal data are anonymised and the
 * history stays; the sessions are closed. One transaction (RN-171), audited (RN-208).
 */
export async function deleteAccount(userId: number, password: string): Promise<void> {
  await withTransaction(async (client) => {
    const account = await lockAccount(client, userId);
    if (!account) throw new UnauthorizedError();
    if (account.role === "ADMIN") throw new ForbiddenError();
    if (!(await verifyPassword(account.passwordHash, password))) throw new BadRequestError("La contraseña no es correcta.");

    if (account.role === "ADOPTER") {
      await voidAdopterProcesses(client, userId);
      await anonymiseAdopter(client, userId, DELETED_NAME);
      await anonymiseAuditLog(client, userId, "Adopter");
    } else {
      await closeShelterProcesses(client, userId);
      await anonymiseShelter(client, userId, DELETED_NAME);
      await anonymiseAuditLog(client, userId, "Shelter");
    }
    await markAccountDeleted(client, userId);
    await deleteUserSessions(client, userId);
    await audit(client, { actorUserId: userId, action: "ACCOUNT_DELETED", entityType: "App_user", entityId: userId, details: { after: { role: account.role } } });
  });
}
