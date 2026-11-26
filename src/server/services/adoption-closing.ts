import { getPool } from "../db/pool.js";
import { withTransaction, type Db } from "../db/transaction.js";
import { ConflictError, NotFoundError } from "../errors.js";
import {
  lockAdoptionToClose,
  markAdoptionCancelled,
  markAdoptionCompleted,
  markAdoptionReturned,
  releaseReservedPet,
  selectNotSelectedAdopters,
  setPetStatus,
  selectAdopterAdoptions,
  selectShelterAdoptions,
  type AdopterAdoption,
  type AdoptionToClose,
  type ShelterAdoption,
} from "../models/adoptions.js";
import { audit } from "./audit.js";
import { alertFavorites, alertPetAvailable } from "./pet-alerts.js";
import { createNotification } from "./notifications.js";

const NOT_FOUND = "La solicitud de adopción no existe.";

type Owner = { adopterId: number } | { shelterId: number };

/** Locks the adoption of that adopter or shelter and runs `change` in one transaction (RN-171). */
async function closeAdoption<S extends string>(
  adoptionId: number,
  owner: Owner,
  change: (client: Db, adoption: AdoptionToClose) => Promise<S>,
): Promise<{ id: number; status: S }> {
  return withTransaction(async (client) => {
    const adoption = await lockAdoptionToClose(client, adoptionId, owner);
    if (!adoption) throw new NotFoundError(NOT_FOUND);
    return { id: adoptionId, status: await change(client, adoption) };
  });
}

/** RN-208: a change of the pet's status. */
async function auditPetStatus(client: Db, actorUserId: number, petId: number, before: string, after: string): Promise<void> {
  await audit(client, {
    actorUserId,
    action: "PET_STATUS_CHANGED",
    entityType: "Pet",
    entityId: petId,
    details: { before: { status: before }, after: { status: after } },
  });
}

/**
 * CU-30, RN-129, RN-130: the adopter withdraws a pending request or backs out of an approved
 * adoption, or the shelter backs out of an approved one; who and why are recorded. If it was
 * approved, the pet is available again, and the other party and the not selected candidates
 * are told.
 */
export async function cancelAdoption(
  actor: "ADOPTER" | "SHELTER",
  userId: number,
  adoptionId: number,
  reason: string,
): Promise<{ id: number; status: "CANCELLED" }> {
  const owner: Owner = actor === "ADOPTER" ? { adopterId: userId } : { shelterId: userId };
  return closeAdoption(adoptionId, owner, async (client, adoption) => {
    if (adoption.status === "COMPLETED") throw new ConflictError("La adopción ya está completada: registra una devolución.");
    if (adoption.status === "PENDING" && actor === "SHELTER") throw new ConflictError("La solicitud está pendiente: recházala en lugar de cancelarla.");
    if (adoption.status !== "PENDING" && adoption.status !== "APPROVED") throw new ConflictError("La adopción ya está cerrada.");

    await markAdoptionCancelled(client, adoptionId, actor, reason);
    await audit(client, {
      actorUserId: userId,
      action: "ADOPTION_CANCELLED",
      entityType: "Adoption",
      entityId: adoptionId,
      details: { before: { status: adoption.status }, after: { status: "CANCELLED", cancelledBy: actor } },
    });
    if (adoption.status !== "APPROVED") return "CANCELLED";

    await createNotification(client, {
      userId: actor === "ADOPTER" ? adoption.shelterId : adoption.adopterId,
      type: actor === "ADOPTER" ? "ADOPTION_CANCELLED_BY_ADOPTER" : "ADOPTION_CANCELLED_BY_SHELTER",
      params: { petName: adoption.petName, reason },
      link: { adoptionId },
    });
    // RN-130
    if (await releaseReservedPet(client, adoption.petId)) {
      await auditPetStatus(client, userId, adoption.petId, "RESERVED", "AVAILABLE");
      const notSelected = await selectNotSelectedAdopters(client, adoption.petId);
      for (const candidate of notSelected) {
        await createNotification(client, { userId: candidate, type: "PET_AVAILABLE_AGAIN", params: { petName: adoption.petName }, link: { petId: adoption.petId } });
      }
      // RN-199, RN-200: the adopter of this adoption and the candidates were already told
      await alertPetAvailable(client, adoption.petId, [adoption.adopterId, ...notSelected]);
    }
    return "CANCELLED";
  });
}

/** CU-31, RN-126: the shelter registers the delivery; the adoption is completed and the pet adopted. */
export async function deliverAdoption(shelterId: number, adoptionId: number): Promise<{ id: number; status: "COMPLETED" }> {
  return closeAdoption(adoptionId, { shelterId }, async (client, adoption) => {
    if (adoption.status !== "APPROVED") throw new ConflictError("La adopción no está aprobada.");
    await markAdoptionCompleted(client, adoptionId);
    await audit(client, {
      actorUserId: shelterId,
      action: "ADOPTION_COMPLETED",
      entityType: "Adoption",
      entityId: adoptionId,
      details: { before: { status: "APPROVED" }, after: { status: "COMPLETED" } },
    });
    await setPetStatus(client, adoption.petId, "ADOPTED");
    await alertFavorites(client, adoption.petId, "ADOPTED", [adoption.adopterId]); // RN-200
    await auditPetStatus(client, shelterId, adoption.petId, "RESERVED", "ADOPTED");
    return "COMPLETED";
  });
}

/** CU-32, RN-131: the shelter registers a return with its reason; the pet is available again. */
export async function returnAdoption(shelterId: number, adoptionId: number, reason: string): Promise<{ id: number; status: "RETURNED" }> {
  return closeAdoption(adoptionId, { shelterId }, async (client, adoption) => {
    if (adoption.status !== "COMPLETED") throw new ConflictError("La adopción no está completada.");
    await markAdoptionReturned(client, adoptionId, reason);
    await audit(client, {
      actorUserId: shelterId,
      action: "ADOPTION_RETURNED",
      entityType: "Adoption",
      entityId: adoptionId,
      details: { before: { status: "COMPLETED" }, after: { status: "RETURNED", reason } },
    });
    await setPetStatus(client, adoption.petId, "AVAILABLE");
    await alertPetAvailable(client, adoption.petId, [adoption.adopterId]); // RN-199, RN-200
    await auditPetStatus(client, shelterId, adoption.petId, "ADOPTED", "AVAILABLE");
    return "RETURNED";
  });
}

/** CU-21: the adopter's adoptions, newest first. */
export async function listAdopterAdoptions(adopterId: number): Promise<AdopterAdoption[]> {
  return selectAdopterAdoptions(getPool(), adopterId);
}

/** CU-22: the shelter's approved adoptions pending delivery and the completed ones. */
export async function listShelterAdoptions(shelterId: number): Promise<ShelterAdoption[]> {
  return selectShelterAdoptions(getPool(), shelterId);
}
