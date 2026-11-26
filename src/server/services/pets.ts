import { getPool } from "../db/pool.js";
import { withTransaction, type Db } from "../db/transaction.js";
import { BadRequestError, NotFoundError } from "../errors.js";
import {
  breedExists,
  countSpecies,
  insertPet,
  replaceGetsAlong,
  selectShelterPet,
  selectShelterPets,
  updatePet,
  type PetData,
  type ShelterPet,
} from "../models/pets.js";
import { audit } from "./audit.js";
import { alertCompatibleAdopters } from "./pet-alerts.js";

export type { PetData, ShelterPet };

const NOT_FOUND = "La mascota no existe.";
const madridDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" });

/** Rules on the data that depend on the catalogues or on today's date. */
async function checkPetData(db: Db, pet: PetData): Promise<void> {
  // RN-43: the approximate birth date cannot be in the future (Spanish time).
  if (pet.birthDate > madridDate.format(new Date())) {
    throw new BadRequestError("La fecha de nacimiento no puede ser futura.");
  }
  // RN-40: every pet has a breed of the catalogue; its species comes from it (RN-41).
  if (!(await breedExists(db, pet.breedId))) throw new BadRequestError("La raza no existe.");
  // RN-46: at most one entry per species, and only species of the catalogue.
  const speciesIds = pet.getsAlongWith.map((item) => item.speciesId);
  if (new Set(speciesIds).size !== speciesIds.length) {
    throw new BadRequestError("Indica la convivencia con cada especie una sola vez.");
  }
  if (speciesIds.length > 0 && (await countSpecies(db, speciesIds)) !== speciesIds.length) {
    throw new BadRequestError("La especie no existe.");
  }
}

/** CU-14: the shelter's pets. */
export async function listShelterPets(shelterId: number): Promise<ShelterPet[]> {
  return selectShelterPets(getPool(), shelterId);
}

/** CU-16: one of the shelter's pets. */
export async function getShelterPet(shelterId: number, petId: number): Promise<ShelterPet> {
  const pet = await selectShelterPet(getPool(), shelterId, petId);
  if (!pet) throw new NotFoundError(NOT_FOUND);
  return pet;
}

/**
 * CU-15: creates a pet, available (RN-53). RN-22: a shelter pending validation can do it
 * too; its pets are not shown to adopters until it is validated.
 */
export async function createPet(shelterId: number, pet: PetData): Promise<ShelterPet> {
  return withTransaction(async (client) => {
    await checkPetData(client, pet);
    const petId = await insertPet(client, shelterId, pet);
    await replaceGetsAlong(client, petId, pet.getsAlongWith);
    await alertCompatibleAdopters(client, petId); // RN-199: only if the pet is visible already
    const created = await selectShelterPet(client, shelterId, petId);
    if (!created) throw new NotFoundError(NOT_FOUND);
    return created;
  });
}

const EDITABLE_FIELDS = [
  "breedId",
  "name",
  "description",
  "birthDate",
  "sex",
  "size",
  "activityLevel",
  "goodWithChildren",
  "getsAlongWith",
  "vaccinated",
  "dewormed",
  "sterilized",
  "microchipped",
  "specialNeeds",
] as const satisfies readonly (keyof PetData)[];

/** RN-208: only the fields that changed, with their old and new values. */
function changes(before: PetData, after: PetData): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const diff = { before: {} as Record<string, unknown>, after: {} as Record<string, unknown> };
  for (const field of EDITABLE_FIELDS) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      diff.before[field] = before[field];
      diff.after[field] = after[field];
    }
  }
  return diff;
}

const sortedGetsAlong = (pet: PetData): PetData => ({
  ...pet,
  getsAlongWith: [...pet.getsAlongWith].sort((a, b) => a.speciesId - b.speciesId),
});

/** CU-16: edits a pet of the shelter. RN-208: the change is recorded in the audit log. */
export async function editPet(shelterId: number, petId: number, pet: PetData): Promise<ShelterPet> {
  return withTransaction(async (client) => {
    const before = await selectShelterPet(client, shelterId, petId, true);
    if (!before) throw new NotFoundError(NOT_FOUND);
    await checkPetData(client, pet);

    const after = sortedGetsAlong(pet);
    await updatePet(client, petId, after);
    await replaceGetsAlong(client, petId, after.getsAlongWith);

    const diff = changes(before, after);
    if (Object.keys(diff.after).length > 0) {
      await audit(client, { actorUserId: shelterId, action: "PET_UPDATED", entityType: "Pet", entityId: petId, details: diff });
    }

    const updated = await selectShelterPet(client, shelterId, petId);
    if (!updated) throw new NotFoundError(NOT_FOUND);
    return updated;
  });
}
