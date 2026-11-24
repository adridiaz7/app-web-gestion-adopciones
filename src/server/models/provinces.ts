import type { Db } from "../db/transaction.js";

export async function provinceExists(db: Db, id: number): Promise<boolean> {
  const { rowCount } = await db.query(`SELECT 1 FROM "Province" WHERE id = $1`, [id]);
  return rowCount === 1;
}

export async function selectProvinces(db: Db): Promise<{ id: number; name: string }[]> {
  const { rows } = await db.query<{ id: number; name: string }>(`SELECT id, name FROM "Province"`);
  return rows;
}

/** RN-39, RN-40: species with their breeds (a JSON array per species). */
export async function selectSpeciesWithBreeds(db: Db): Promise<{ id: number; name: string; breeds: { id: number; name: string }[] }[]> {
  const { rows } = await db.query<{ id: number; name: string; breeds: { id: number; name: string }[] }>(
    `SELECT s.id, s.name,
            coalesce((SELECT json_agg(json_build_object('id', b.id, 'name', b.name)) FROM "Breed" b WHERE b.species_id = s.id), '[]'::json) AS breeds
       FROM "Species" s`,
  );
  return rows;
}
