import type { Db } from "../db/transaction.js";

export async function provinceExists(db: Db, id: number): Promise<boolean> {
  const { rowCount } = await db.query(`SELECT 1 FROM "Province" WHERE id = $1`, [id]);
  return rowCount === 1;
}

export async function selectProvinces(db: Db): Promise<{ id: number; name: string }[]> {
  const { rows } = await db.query<{ id: number; name: string }>(`SELECT id, name FROM "Province"`);
  return rows;
}
