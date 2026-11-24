import type { Db } from "../db/transaction.js";

export interface ShelterInsert {
  userId: number;
  name: string;
  /** Already normalised by the controller (upper case, no spaces or hyphens). */
  cif: string;
  address: string;
  provinceId: number;
  locality: string;
  phone: string;
}

/** RN-17: whether a shelter already has this CIF. */
export async function cifExists(db: Db, cif: string): Promise<boolean> {
  const { rowCount } = await db.query(`SELECT 1 FROM "Shelter" WHERE cif = $1`, [cif]);
  return rowCount === 1;
}

/**
 * Inserts a shelter pending validation (RN-14, column default). Returns false when the
 * CIF is already taken (RN-17: unique constraint), so a concurrent sign-up with the same
 * CIF gets the same answer as one that was caught before.
 */
export async function insertShelterIfCifFree(db: Db, shelter: ShelterInsert): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO "Shelter" (user_id, name, cif, address, province_id, locality, phone)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (cif) DO NOTHING`,
    [
      shelter.userId,
      shelter.name,
      shelter.cif,
      shelter.address,
      shelter.provinceId,
      shelter.locality,
      shelter.phone,
    ],
  );
  return rowCount === 1;
}
