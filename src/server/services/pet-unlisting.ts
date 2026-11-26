import { withTransaction } from "../db/transaction.js";
import { ConflictError, NotFoundError } from "../errors.js";
import { selectAdoptersVoidedByUnlisting, voidPetPendingAdoptions } from "../models/adoptions.js";
import { markPetReactivated, markPetUnlisted, selectShelterPet, type ShelterPet, type UnlistReason } from "../models/pets.js";
import { voidPetOpenVisits } from "../models/visits.js";
import { audit } from "./audit.js";
import { alertFavorites, alertPetAvailable } from "./pet-alerts.js";
import { createNotification } from "./notifications.js";

const NOT_FOUND = "La mascota no existe.";

/** RN-62: the reasons a shelter can choose (REMOVED_BY_ADMIN is only for the administrator). */
export type ShelterUnlistReason = Exclude<UnlistReason, "REMOVED_BY_ADMIN">;

/**
 * CU-17, RN-60 to RN-62, RN-65, RN-66: the shelter unlists an available pet with a reason.
 * Its open visits and pending adoptions become VOIDED (PET_UNLISTED) and each adopter gets the
 * template of that reason. One transaction (RN-171), audited (RN-208).
 */
export async function unlistPet(shelterId: number, petId: number, reason: ShelterUnlistReason): Promise<ShelterPet> {
  return withTransaction(async (client) => {
    const pet = await selectShelterPet(client, shelterId, petId, true);
    if (!pet) throw new NotFoundError(NOT_FOUND);
    // RN-61
    if (pet.status === "RESERVED") throw new ConflictError("La mascota está reservada: primero cancela la adopción aprobada.");
    if (pet.status !== "AVAILABLE") throw new ConflictError("Solo se puede dar de baja una mascota disponible.");

    await markPetUnlisted(client, petId, reason);
    await alertFavorites(client, petId, "UNLISTED"); // RN-200
    await audit(client, {
      actorUserId: shelterId,
      action: "PET_STATUS_CHANGED",
      entityType: "Pet",
      entityId: petId,
      details: { before: { status: "AVAILABLE" }, after: { status: "UNLISTED", unlistReason: reason } },
    });

    for (const visit of await voidPetOpenVisits(client, petId, "PET_UNLISTED")) {
      await createNotification(client, {
        userId: visit.adopterId,
        type: "VISIT_VOIDED_PET_UNLISTED",
        params: { petName: visit.petName, startsAt: visit.startsAt, reason },
        link: { visitId: visit.id },
      });
      await audit(client, {
        actorUserId: shelterId,
        action: "VISIT_VOIDED",
        entityType: "Visit",
        entityId: visit.id,
        details: { before: { status: visit.previousStatus }, after: { status: "VOIDED", voidReason: "PET_UNLISTED" } },
      });
    }

    for (const adoption of await voidPetPendingAdoptions(client, petId, "PET_UNLISTED")) {
      await createNotification(client, {
        userId: adoption.adopterId,
        type: "ADOPTION_VOIDED_PET_UNLISTED",
        params: { petName: adoption.petName, reason },
        link: { adoptionId: adoption.id },
      });
      await audit(client, {
        actorUserId: shelterId,
        action: "ADOPTION_VOIDED",
        entityType: "Adoption",
        entityId: adoption.id,
        details: { before: { status: "PENDING" }, after: { status: "VOIDED", voidReason: "PET_UNLISTED" } },
      });
    }

    const updated = await selectShelterPet(client, shelterId, petId);
    if (!updated) throw new NotFoundError(NOT_FOUND);
    return updated;
  });
}

/**
 * CU-17, RN-63, RN-64, RN-67: the shelter makes an unlisted pet available again, unless the
 * administrator removed it. The adopters whose visits or adoptions this unlisting voided are
 * told. One transaction (RN-171), audited (RN-208).
 */
export async function reactivatePet(shelterId: number, petId: number): Promise<ShelterPet> {
  return withTransaction(async (client) => {
    const pet = await selectShelterPet(client, shelterId, petId, true);
    if (!pet) throw new NotFoundError(NOT_FOUND);
    if (pet.status !== "UNLISTED" || !pet.unlistedAt) throw new ConflictError("La mascota no está de baja.");
    if (pet.unlistReason === "REMOVED_BY_ADMIN") {
      throw new ConflictError("La mascota fue retirada por el administrador y no se puede reactivar.");
    }

    const adopters = await selectAdoptersVoidedByUnlisting(client, petId, pet.unlistedAt);
    await markPetReactivated(client, petId);
    await audit(client, {
      actorUserId: shelterId,
      action: "PET_STATUS_CHANGED",
      entityType: "Pet",
      entityId: petId,
      details: { before: { status: "UNLISTED", unlistReason: pet.unlistReason }, after: { status: "AVAILABLE" } },
    });
    for (const userId of adopters) {
      await createNotification(client, { userId, type: "PET_AVAILABLE_AGAIN", params: { petName: pet.name }, link: { petId } });
    }
    // RN-199, RN-200
    await alertPetAvailable(client, petId, adopters);

    const updated = await selectShelterPet(client, shelterId, petId);
    if (!updated) throw new NotFoundError(NOT_FOUND);
    return updated;
  });
}
