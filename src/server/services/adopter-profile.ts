import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import { BadRequestError, NotFoundError } from "../errors.js";
import {
  selectAdopterProfile,
  updateAdopterPersonalData,
  updateHousehold,
  type AdopterPersonalData,
  type AdopterProfileRow,
  type Household,
} from "../models/adopters.js";
import { provinceExists } from "../models/provinces.js";
import { audit } from "./audit.js";
import { fieldChanges, hasChanges } from "./field-changes.js";
import { isAdult, madridToday } from "./registration.js";

export type AdopterProfile = AdopterProfileRow;
export type AdopterProfileUpdate = AdopterPersonalData & { household: Household };

const NOT_FOUND = "El adoptante no existe.";

const PERSONAL_FIELDS = ["firstName", "lastName", "phone", "birthDate", "provinceId", "locality"] as const satisfies readonly (keyof AdopterPersonalData)[];
const HOUSEHOLD_FIELDS = [
  "housingType",
  "hasOutdoorSpace",
  "housingTenure",
  "householdMembers",
  "hasChildren",
  "hasOtherPets",
  "otherPetsDescription",
  "hasPetExperience",
  "hoursAlonePerDay",
] as const satisfies readonly (keyof Household)[];

/** CU-06: the adopter's own profile. */
export async function getAdopterProfile(adopterId: number): Promise<AdopterProfile> {
  const profile = await selectAdopterProfile(getPool(), adopterId);
  if (!profile) throw new NotFoundError(NOT_FOUND);
  return profile;
}

/**
 * CU-06: edits the personal data and the household data (RN-27: they may stay empty).
 * RN-25: the new birth date must still be an adult's. RN-208: the edit is audited with the
 * old and new values of the fields that change, in the same transaction (RN-171).
 */
export async function editAdopterProfile(adopterId: number, input: AdopterProfileUpdate): Promise<AdopterProfile> {
  if (!isAdult(input.birthDate, madridToday())) throw new BadRequestError("Tienes que ser mayor de edad.");

  return withTransaction(async (client) => {
    if (!(await provinceExists(client, input.provinceId))) throw new BadRequestError("La provincia no existe.");
    const before = await selectAdopterProfile(client, adopterId, true);
    if (!before) throw new NotFoundError(NOT_FOUND);

    await updateAdopterPersonalData(client, adopterId, input);
    await updateHousehold(client, adopterId, input.household);

    const personal = fieldChanges<AdopterPersonalData>(before, input, PERSONAL_FIELDS);
    const household = fieldChanges(before.household, input.household, HOUSEHOLD_FIELDS);
    const diff = { before: { ...personal.before, ...household.before }, after: { ...personal.after, ...household.after } };
    if (hasChanges(diff)) {
      await audit(client, { actorUserId: adopterId, action: "PROFILE_UPDATED", entityType: "Adopter", entityId: adopterId, details: diff });
    }

    const after = await selectAdopterProfile(client, adopterId);
    if (!after) throw new NotFoundError(NOT_FOUND);
    return after;
  });
}
