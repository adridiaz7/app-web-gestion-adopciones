import { getConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors.js";
import { selectHousehold, updateHousehold, type Household } from "../models/adopters.js";
import { hasOpenAdoption, insertAdoption, selectLatestCompletedVisit } from "../models/adoptions.js";
import { selectActiveBlock } from "../models/shelter-search.js";
import { hasNoShow, lockPetForRequest } from "../models/visits.js";
import { audit } from "./audit.js";

export type { Household };

/** RN-207: the two optional questions; only the answered ones are stored. */
export interface AdoptionAnswers {
  reason?: string;
  canAffordCosts?: boolean;
}

/** The household data, complete (RN-117): only `otherPetsDescription` may be empty. */
export type CompleteHousehold = { [K in keyof Household]: K extends "otherPetsDescription" ? string | null : NonNullable<Household[K]> };

export interface RequestedAdoption {
  id: number;
  status: "PENDING";
  petId: number;
  petName: string;
}

const PET_NOT_AVAILABLE = "Esta mascota no está disponible.";
const madridDay = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long", year: "numeric" });

const HOUSEHOLD_FIELDS: readonly (keyof Household)[] = [
  "housingType",
  "hasOutdoorSpace",
  "housingTenure",
  "householdMembers",
  "hasChildren",
  "hasOtherPets",
  "otherPetsDescription",
  "hasPetExperience",
  "hoursAlonePerDay",
];

/** RN-208: only the household fields that change, with their old and new values. */
function householdChanges(before: Household, after: Household): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const diff: { before: Record<string, unknown>; after: Record<string, unknown> } = { before: {}, after: {} };
  for (const field of HOUSEHOLD_FIELDS) {
    if (before[field] !== after[field]) {
      diff.before[field] = before[field];
      diff.after[field] = after[field];
    }
  }
  return diff;
}

/** RN-207: the household data of the profile, to prefill the adoption form. */
export async function getHousehold(adopterId: number): Promise<Household> {
  const household = await selectHousehold(getPool(), adopterId);
  if (!household) throw new NotFoundError("El adoptante no existe.");
  return household;
}

/**
 * CU-27: the adopter requests the adoption of a pet they visited. In one transaction (RN-171)
 * the household data are saved in the profile (RN-207) and a PENDING adoption is created,
 * linked to the completed visit that enables it (RN-114) and with the optional answers.
 */
export async function requestAdoption(adopterId: number, petId: number, household: CompleteHousehold, answers: AdoptionAnswers): Promise<RequestedAdoption> {
  const months = getConfig().rules.visitValidityForAdoptionMonths;
  return withTransaction(async (client) => {
    const pet = await lockPetForRequest(client, petId);
    if (!pet?.shelterVisible) throw new NotFoundError(PET_NOT_AVAILABLE);
    const { petName } = pet;

    // RN-118: blocked (same neutral text as RN-149) or with a no-show at the shelter.
    const block = await selectActiveBlock(client, pet.shelterId, adopterId);
    if (block) {
      const until = block.endsAt ? ` hasta el ${madridDay.format(block.endsAt)}` : "";
      throw new ForbiddenError(`La protectora ${pet.shelterName} ha restringido tu acceso a sus mascotas${until}.`);
    }
    if (await hasNoShow(client, adopterId, pet.shelterId)) {
      throw new ForbiddenError("No puedes solicitar adopciones en esta protectora porque no acudiste a una visita confirmada.");
    }
    if (pet.status !== "AVAILABLE") throw new ConflictError(PET_NOT_AVAILABLE);
    // RN-119
    if (await hasOpenAdoption(client, adopterId, petId)) throw new ConflictError(`Ya tienes una solicitud de adopción abierta para ${petName}.`);

    // RN-113, RN-115, RN-116: a completed visit to this pet, within its validity.
    const visit = await selectLatestCompletedVisit(client, adopterId, petId, months);
    if (!visit) throw new ConflictError(`Para solicitar la adopción tienes que haber visitado antes a ${petName}.`);
    if (!visit.stillValid) {
      const period = months === 1 ? "1 mes" : `${String(months)} meses`;
      throw new ConflictError(`Tu visita a ${petName} fue hace más de ${period}. Para solicitar la adopción, haz otra visita.`);
    }

    // RN-117, RN-207; RN-208: a change of the profile is audited with old and new values.
    const before = await selectHousehold(client, adopterId, true);
    if (!before) throw new NotFoundError("El adoptante no existe.");
    await updateHousehold(client, adopterId, household);
    const diff = householdChanges(before, household);
    if (Object.keys(diff.after).length > 0) {
      await audit(client, { actorUserId: adopterId, action: "PROFILE_UPDATED", entityType: "Adopter", entityId: adopterId, details: diff });
    }
    const id = await insertAdoption(client, adopterId, petId, visit.id, answers);
    await audit(client, {
      actorUserId: adopterId,
      action: "ADOPTION_REQUESTED",
      entityType: "Adoption",
      entityId: id,
      details: { after: { status: "PENDING", visitId: visit.id } },
    });
    return { id, status: "PENDING", petId, petName };
  });
}
