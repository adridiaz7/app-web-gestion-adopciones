import { withTransaction } from "../db/transaction.js";
import { BadRequestError, ConflictError, NotFoundError } from "../errors.js";
import {
  breedNameTaken,
  insertBreed,
  insertSpecies,
  lockCatalogue,
  selectBreed,
  selectSpecies,
  speciesNameTaken,
  updateBreedName,
  updateSpeciesName,
  type BreedRow,
  type SpeciesRow,
} from "../models/catalogues.js";
import { audit } from "./audit.js";
import { getPool } from "../db/pool.js";
import { selectProvinces, selectSpeciesWithBreeds } from "../models/provinces.js";

const spanishOrder = new Intl.Collator("es");

/** The provinces, in Spanish alphabetical order (accents included), for the forms. */
export async function listProvinces(): Promise<{ id: number; name: string }[]> {
  const provinces = await selectProvinces(getPool());
  return provinces.sort((a, b) => spanishOrder.compare(a.name, b.name));
}

/** RN-39, RN-40: species and breeds in Spanish order, with "Mestizo / Desconocida" first in each species. */
export async function listSpeciesWithBreeds(): Promise<{ id: number; name: string; breeds: { id: number; name: string }[] }[]> {
  const MIXED = "Mestizo / Desconocida";
  const species = await selectSpeciesWithBreeds(getPool());
  return species
    .sort((a, b) => spanishOrder.compare(a.name, b.name))
    .map((s) => ({
      ...s,
      breeds: s.breeds.sort((a, b) =>
        a.name === MIXED ? -1 : b.name === MIXED ? 1 : spanishOrder.compare(a.name, b.name),
      ),
    }));
}

const SPECIES_TAKEN = "Ya existe una especie con ese nombre.";
const BREED_TAKEN = "Ya existe una raza con ese nombre en esta especie.";

/** CU-42, RN-159: the administrator adds a species; names are unique ignoring case. Audited (RN-208). */
export async function createSpecies(adminId: number, name: string): Promise<SpeciesRow> {
  return withTransaction(async (client) => {
    await lockCatalogue(client, "Species");
    if (await speciesNameTaken(client, name, null)) throw new ConflictError(SPECIES_TAKEN);
    const species = await insertSpecies(client, name);
    await audit(client, { actorUserId: adminId, action: "SPECIES_CREATED", entityType: "Species", entityId: species.id, details: { after: { name } } });
    return species;
  });
}

/** CU-42, RN-159: the administrator renames a species. Audited with the old and new name (RN-208). */
export async function renameSpecies(adminId: number, id: number, name: string): Promise<SpeciesRow> {
  return withTransaction(async (client) => {
    await lockCatalogue(client, "Species");
    const before = await selectSpecies(client, id);
    if (!before) throw new NotFoundError("La especie no existe.");
    if (await speciesNameTaken(client, name, id)) throw new ConflictError(SPECIES_TAKEN);
    const species = await updateSpeciesName(client, id, name);
    if (before.name !== name) {
      await audit(client, { actorUserId: adminId, action: "SPECIES_UPDATED", entityType: "Species", entityId: id, details: { before: { name: before.name }, after: { name } } });
    }
    return species;
  });
}

/** CU-42, RN-159: the administrator adds a breed to an existing species. Audited (RN-208). */
export async function createBreed(adminId: number, speciesId: number, name: string): Promise<BreedRow> {
  return withTransaction(async (client) => {
    await lockCatalogue(client, "Breed");
    if (!(await selectSpecies(client, speciesId))) throw new BadRequestError("La especie no existe.");
    if (await breedNameTaken(client, speciesId, name, null)) throw new ConflictError(BREED_TAKEN);
    const breed = await insertBreed(client, speciesId, name);
    await audit(client, { actorUserId: adminId, action: "BREED_CREATED", entityType: "Breed", entityId: breed.id, details: { after: { speciesId, name } } });
    return breed;
  });
}

/** CU-42, RN-159: the administrator renames a breed (its species does not change: RN-41). Audited (RN-208). */
export async function renameBreed(adminId: number, id: number, name: string): Promise<BreedRow> {
  return withTransaction(async (client) => {
    await lockCatalogue(client, "Breed");
    const before = await selectBreed(client, id);
    if (!before) throw new NotFoundError("La raza no existe.");
    if (await breedNameTaken(client, before.speciesId, name, id)) throw new ConflictError(BREED_TAKEN);
    const breed = await updateBreedName(client, id, name);
    if (before.name !== name) {
      await audit(client, { actorUserId: adminId, action: "BREED_UPDATED", entityType: "Breed", entityId: id, details: { before: { name: before.name }, after: { name } } });
    }
    return breed;
  });
}
