import { getPool } from "../db/pool.js";
import { selectProvinces } from "../models/provinces.js";

const spanishOrder = new Intl.Collator("es");

/** The provinces, in Spanish alphabetical order (accents included), for the forms. */
export async function listProvinces(): Promise<{ id: number; name: string }[]> {
  const provinces = await selectProvinces(getPool());
  return provinces.sort((a, b) => spanishOrder.compare(a.name, b.name));
}
