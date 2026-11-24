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
