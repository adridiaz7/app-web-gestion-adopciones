import type { Db } from "../db/transaction.js";

export interface SpeciesRow {
  id: number;
  name: string;
}

export interface BreedRow {
  id: number;
  speciesId: number;
  name: string;
}

/** CU-42: serialises catalogue changes, so two equal names cannot slip in at the same time. */
export async function lockCatalogue(db: Db, table: "Species" | "Breed"): Promise<void> {
  await db.query(`LOCK TABLE "${table}" IN SHARE ROW EXCLUSIVE MODE`);
}

export async function selectSpecies(db: Db, id: number): Promise<SpeciesRow | null> {
  const { rows } = await db.query<SpeciesRow>(`SELECT id, name FROM "Species" WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** CU-42: whether another species has that name, ignoring case. */
export async function speciesNameTaken(db: Db, name: string, exceptId: number | null): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM "Species" WHERE lower(name) = lower($1) AND id IS DISTINCT FROM $2 LIMIT 1`, [name, exceptId]);
  return rows.length > 0;
}

export async function insertSpecies(db: Db, name: string): Promise<SpeciesRow> {
  const { rows } = await db.query<SpeciesRow>(`INSERT INTO "Species" (name) VALUES ($1) RETURNING id, name`, [name]);
  const row = rows[0];
  if (!row) throw new Error("insertSpecies: no row returned");
  return row;
}

export async function updateSpeciesName(db: Db, id: number, name: string): Promise<SpeciesRow> {
  const { rows } = await db.query<SpeciesRow>(`UPDATE "Species" SET name = $2 WHERE id = $1 RETURNING id, name`, [id, name]);
  const row = rows[0];
  if (!row) throw new Error("updateSpeciesName: no row returned");
  return row;
}

const BREED_COLUMNS = `id, species_id AS "speciesId", name`;

export async function selectBreed(db: Db, id: number): Promise<BreedRow | null> {
  const { rows } = await db.query<BreedRow>(`SELECT ${BREED_COLUMNS} FROM "Breed" WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** CU-42: whether another breed of the species has that name, ignoring case. */
export async function breedNameTaken(db: Db, speciesId: number, name: string, exceptId: number | null): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM "Breed" WHERE species_id = $1 AND lower(name) = lower($2) AND id IS DISTINCT FROM $3 LIMIT 1`,
    [speciesId, name, exceptId],
  );
  return rows.length > 0;
}

export async function insertBreed(db: Db, speciesId: number, name: string): Promise<BreedRow> {
  const { rows } = await db.query<BreedRow>(`INSERT INTO "Breed" (species_id, name) VALUES ($1, $2) RETURNING ${BREED_COLUMNS}`, [speciesId, name]);
  const row = rows[0];
  if (!row) throw new Error("insertBreed: no row returned");
  return row;
}

export async function updateBreedName(db: Db, id: number, name: string): Promise<BreedRow> {
  const { rows } = await db.query<BreedRow>(`UPDATE "Breed" SET name = $2 WHERE id = $1 RETURNING ${BREED_COLUMNS}`, [id, name]);
  const row = rows[0];
  if (!row) throw new Error("updateBreedName: no row returned");
  return row;
}
