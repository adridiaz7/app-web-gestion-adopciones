import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import { ConflictError, NotFoundError } from "../errors.js";
import {
  lockShelterAdoption,
  markAdoptionApproved,
  markAdoptionRejected,
  markOthersNotSelected,
  petHasActiveAdoption,
  reservePet,
  selectCandidates,
  type CandidateRow,
} from "../models/adoptions.js";
import { selectShelterPet } from "../models/pets.js";
import { voidPetOpenVisits } from "../models/visits.js";
import { audit } from "./audit.js";
import { createNotification } from "./notifications.js";

export type { CandidateRow };

const NOT_FOUND = "La solicitud de adopción no existe.";
const NOT_PENDING = "La solicitud no está pendiente.";

/** CU-28, RN-121: the pending requests of one of the shelter's pets, to compare the candidates. */
export async function listCandidates(
  shelterId: number,
  petId: number,
): Promise<{ pet: { id: number; name: string; status: string }; candidates: CandidateRow[] }> {
  const pool = getPool();
  const pet = await selectShelterPet(pool, shelterId, petId);
  if (!pet) throw new NotFoundError("La mascota no existe.");
  return { pet: { id: pet.id, name: pet.name, status: pet.status }, candidates: await selectCandidates(pool, petId) };
}

/**
 * CU-29, RN-124, RN-125: the shelter approves a pending request. The pet becomes RESERVED, the
 * other pending requests NOT_SELECTED and the pet's open visits VOIDED (PET_RESERVED, RN-109);
 * everyone affected is told. One transaction (RN-171), audited (RN-208).
 */
export async function approveAdoption(shelterId: number, adoptionId: number): Promise<{ id: number; status: "APPROVED" }> {
  return withTransaction(async (client) => {
    const adoption = await lockShelterAdoption(client, shelterId, adoptionId);
    if (!adoption) throw new NotFoundError(NOT_FOUND);
    if (adoption.status !== "PENDING") throw new ConflictError(NOT_PENDING);
    if (await petHasActiveAdoption(client, adoption.petId)) throw new ConflictError(`${adoption.petName} ya tiene una adopción aprobada o completada.`);

    await markAdoptionApproved(client, adoptionId);
    await createNotification(client, { userId: adoption.adopterId, type: "ADOPTION_APPROVED", params: { petName: adoption.petName }, link: { adoptionId } });
    await audit(client, {
      actorUserId: shelterId,
      action: "ADOPTION_APPROVED",
      entityType: "Adoption",
      entityId: adoptionId,
      details: { before: { status: "PENDING" }, after: { status: "APPROVED" } },
    });

    await reservePet(client, adoption.petId);
    await audit(client, {
      actorUserId: shelterId,
      action: "PET_STATUS_CHANGED",
      entityType: "Pet",
      entityId: adoption.petId,
      details: { before: { status: "AVAILABLE" }, after: { status: "RESERVED" } },
    });

    for (const other of await markOthersNotSelected(client, adoption.petId, adoptionId)) {
      await createNotification(client, { userId: other.adopterId, type: "ADOPTION_NOT_SELECTED", params: { petName: other.petName }, link: { adoptionId: other.id } });
      await audit(client, {
        actorUserId: shelterId,
        action: "ADOPTION_NOT_SELECTED",
        entityType: "Adoption",
        entityId: other.id,
        details: { before: { status: "PENDING" }, after: { status: "NOT_SELECTED" } },
      });
    }

    for (const visit of await voidPetOpenVisits(client, adoption.petId, "PET_RESERVED")) {
      // RN-110
      await createNotification(client, {
        userId: visit.adopterId,
        type: "VISIT_VOIDED_PET_RESERVED",
        params: { petName: visit.petName, startsAt: visit.startsAt },
        link: { visitId: visit.id },
      });
      await audit(client, {
        actorUserId: shelterId,
        action: "VISIT_VOIDED",
        entityType: "Visit",
        entityId: visit.id,
        details: { before: { status: visit.previousStatus }, after: { status: "VOIDED", voidReason: "PET_RESERVED" } },
      });
    }
    return { id: adoptionId, status: "APPROVED" };
  });
}

/** CU-29, RN-123: the shelter rejects a pending request with a reason; the adopter is told. */
export async function rejectAdoption(shelterId: number, adoptionId: number, reason: string): Promise<{ id: number; status: "REJECTED" }> {
  return withTransaction(async (client) => {
    const adoption = await lockShelterAdoption(client, shelterId, adoptionId);
    if (!adoption) throw new NotFoundError(NOT_FOUND);
    if (adoption.status !== "PENDING") throw new ConflictError(NOT_PENDING);
    await markAdoptionRejected(client, adoptionId, reason);
    await createNotification(client, { userId: adoption.adopterId, type: "ADOPTION_REJECTED", params: { petName: adoption.petName, reason }, link: { adoptionId } });
    await audit(client, {
      actorUserId: shelterId,
      action: "ADOPTION_REJECTED",
      entityType: "Adoption",
      entityId: adoptionId,
      details: { before: { status: "PENDING" }, after: { status: "REJECTED" } },
    });
    return { id: adoptionId, status: "REJECTED" };
  });
}
