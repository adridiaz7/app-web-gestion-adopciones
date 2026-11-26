import { getConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { withTransaction, type Db } from "../db/transaction.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors.js";
import { selectHousehold, updateHousehold, type Household } from "../models/adopters.js";
import { hasOpenAdoption, insertAdoption, selectLatestCompletedVisit } from "../models/adoptions.js";
import { selectActiveBlock } from "../models/shelter-search.js";
import { hasNoShow, lockPetForRequest, selectPetForRequest, type PetForRequest } from "../models/visits.js";
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

/** T-52: why the adopter cannot request the adoption of a pet right now. */
export type AdoptionIneligibility =
  | { reason: "BLOCKED"; endsAt: Date | null }
  | { reason: "NO_SHOW" | "NOT_AVAILABLE" | "OPEN_REQUEST" | "NO_VISIT" | "VISIT_EXPIRED" };

/** T-52: what the pet profile shows (RN-117 does not count: the household is filled in on the form). */
export interface AdoptionEligibility {
  canRequest: boolean;
  reason: AdoptionIneligibility["reason"] | null;
  message: string | null;
}

type Checked = { ok: true; visitId: number } | ({ ok: false } & AdoptionIneligibility);

/**
 * CU-27: the conditions to request the adoption of a visible pet, in the order the request
 * checks them. The same function serves the request and the eligibility shown in the profile (T-52).
 */
async function checkConditions(db: Db, adopterId: number, petId: number, pet: PetForRequest, months: number): Promise<Checked> {
  // RN-118: blocked or with a no-show at the shelter.
  const block = await selectActiveBlock(db, pet.shelterId, adopterId);
  if (block) return { ok: false, reason: "BLOCKED", endsAt: block.endsAt };
  if (await hasNoShow(db, adopterId, pet.shelterId)) return { ok: false, reason: "NO_SHOW" };
  if (pet.status !== "AVAILABLE") return { ok: false, reason: "NOT_AVAILABLE" };
  // RN-119
  if (await hasOpenAdoption(db, adopterId, petId)) return { ok: false, reason: "OPEN_REQUEST" };
  // RN-113, RN-115, RN-116: a completed visit to this pet, within its validity.
  const visit = await selectLatestCompletedVisit(db, adopterId, petId, months);
  if (!visit) return { ok: false, reason: "NO_VISIT" };
  if (!visit.stillValid) return { ok: false, reason: "VISIT_EXPIRED" };
  return { ok: true, visitId: visit.id };
}

/** RN-149: the same neutral text for a block everywhere. */
function blockMessage(shelterName: string, endsAt: Date | null): string {
  const until = endsAt ? ` hasta el ${madridDay.format(endsAt)}` : "";
  return `La protectora ${shelterName} ha restringido tu acceso a sus mascotas${until}.`;
}

const NO_SHOW_MESSAGE = "No puedes solicitar adopciones en esta protectora porque no acudiste a una visita confirmada.";

/** The error of POST /api/adopter/adoptions for each unmet condition. */
function requestError(failure: AdoptionIneligibility, pet: PetForRequest, months: number): Error {
  switch (failure.reason) {
    case "BLOCKED":
      return new ForbiddenError(blockMessage(pet.shelterName, failure.endsAt));
    case "NO_SHOW":
      return new ForbiddenError(NO_SHOW_MESSAGE);
    case "NOT_AVAILABLE":
      return new ConflictError(PET_NOT_AVAILABLE);
    case "OPEN_REQUEST":
      return new ConflictError(`Ya tienes una solicitud de adopción abierta para ${pet.petName}.`);
    case "NO_VISIT":
      return new ConflictError(`Para solicitar la adopción tienes que haber visitado antes a ${pet.petName}.`);
    case "VISIT_EXPIRED": {
      const period = months === 1 ? "1 mes" : `${String(months)} meses`;
      return new ConflictError(`Tu visita a ${pet.petName} fue hace más de ${period}. Para solicitar la adopción, haz otra visita.`);
    }
  }
}

/** T-52: the text under the disabled "Solicitar adopción" button of the profile. */
function eligibilityMessage(failure: AdoptionIneligibility, pet: PetForRequest, months: number): string {
  switch (failure.reason) {
    case "BLOCKED":
      return blockMessage(pet.shelterName, failure.endsAt);
    case "NO_SHOW":
      return NO_SHOW_MESSAGE;
    case "NOT_AVAILABLE":
      return PET_NOT_AVAILABLE;
    case "OPEN_REQUEST":
      return `Ya has solicitado adoptar a ${pet.petName}.`;
    case "NO_VISIT":
      return `Para solicitar la adopción, primero tienes que visitar a ${pet.petName}.`;
    case "VISIT_EXPIRED": {
      const period = months === 1 ? "un mes" : `${String(months)} meses`;
      return `Tu visita a ${pet.petName} fue hace más de ${period}: pide otra visita para poder adoptarla.`;
    }
  }
}

/**
 * T-52, CU-11: whether the adopter can request the adoption of the pet now and, if not, why.
 * T-54: a read, so it neither opens a transaction nor locks the pet; the request itself does.
 */
export async function getAdoptionEligibility(adopterId: number, petId: number): Promise<AdoptionEligibility> {
  const months = getConfig().rules.visitValidityForAdoptionMonths;
  const db = getPool();
  const pet = await selectPetForRequest(db, petId);
  if (!pet?.shelterVisible) throw new NotFoundError(PET_NOT_AVAILABLE);
  const checked = await checkConditions(db, adopterId, petId, pet, months);
  if (checked.ok) return { canRequest: true, reason: null, message: null };
  return { canRequest: false, reason: checked.reason, message: eligibilityMessage(checked, pet, months) };
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
    const checked = await checkConditions(client, adopterId, petId, pet, months);
    if (!checked.ok) throw requestError(checked, pet, months);
    const visit = { id: checked.visitId };

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
