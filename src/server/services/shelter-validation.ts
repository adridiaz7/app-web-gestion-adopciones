import { getPool } from "../db/pool.js";
import { withTransaction, type Db } from "../db/transaction.js";
import { ConflictError, NotFoundError } from "../errors.js";
import {
  lockShelterStatus,
  markShelterRejected,
  markShelterValidated,
  selectShelterForAdmin,
  selectSheltersByStatus,
  type ShelterForAdmin,
  type ValidationStatus,
} from "../models/shelters.js";
import { audit } from "./audit.js";

export type { ShelterForAdmin, ValidationStatus };

const NOT_FOUND = "La protectora no existe.";
const NOT_PENDING = "La protectora no está pendiente de validación.";
const NOT_VALIDATED = "La protectora no está validada.";

/** CU-39: shelters with that validation status. */
export async function listShelters(status: ValidationStatus): Promise<ShelterForAdmin[]> {
  return selectSheltersByStatus(getPool(), status);
}

/**
 * Changes the validation status of a shelter that is in `expected`, in one transaction
 * with its audit entry (RN-208), and returns the shelter as it is now.
 */
async function changeStatus(
  adminId: number,
  shelterId: number,
  expected: ValidationStatus,
  wrongStatusMessage: string,
  action: string,
  apply: (client: Db) => Promise<{ validationStatus: ValidationStatus; validationReason?: string }>,
): Promise<ShelterForAdmin> {
  return withTransaction(async (client) => {
    const current = await lockShelterStatus(client, shelterId);
    if (!current) throw new NotFoundError(NOT_FOUND);
    if (current !== expected) throw new ConflictError(wrongStatusMessage);

    const after = await apply(client);
    await audit(client, {
      actorUserId: adminId,
      action,
      entityType: "Shelter",
      entityId: shelterId,
      details: { before: { validationStatus: current }, after },
    });

    const shelter = await selectShelterForAdmin(client, shelterId);
    if (!shelter) throw new NotFoundError(NOT_FOUND);
    return shelter;
  });
}

/** CU-39, RN-14: validates a pending shelter, so its pets become visible (RN-15). */
export async function validateShelter(adminId: number, shelterId: number): Promise<ShelterForAdmin> {
  return changeStatus(adminId, shelterId, "PENDING", NOT_PENDING, "SHELTER_VALIDATED", async (client) => {
    await markShelterValidated(client, shelterId);
    return { validationStatus: "VALIDATED" };
  });
}

/** CU-39, RN-18: rejects a pending shelter, with a reason. */
export async function rejectShelter(adminId: number, shelterId: number, reason: string): Promise<ShelterForAdmin> {
  return changeStatus(adminId, shelterId, "PENDING", NOT_PENDING, "SHELTER_REJECTED", async (client) => {
    await markShelterRejected(client, shelterId, reason);
    return { validationStatus: "REJECTED", validationReason: reason };
  });
}

/**
 * CU-39, RN-19: revokes the validation of a shelter, which goes back to rejected with a
 * reason. RN-23: its pets stop being visible, but its pets, visits and adoptions are not
 * changed, so whatever is in progress can be finished.
 */
export async function revokeShelterValidation(adminId: number, shelterId: number, reason: string): Promise<ShelterForAdmin> {
  return changeStatus(adminId, shelterId, "VALIDATED", NOT_VALIDATED, "SHELTER_VALIDATION_REVOKED", async (client) => {
    await markShelterRejected(client, shelterId, reason);
    return { validationStatus: "REJECTED", validationReason: reason };
  });
}
