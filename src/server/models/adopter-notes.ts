import type { Db } from "../db/transaction.js";

/** RN-204: a shelter's internal note about an adopter, with its dates. */
export interface AdopterNote {
  id: number;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

const NOTE = `id, body, created_at AS "createdAt", updated_at AS "updatedAt"`;

/** The shelter's notes about the adopter, newest first. */
export async function selectNotes(db: Db, shelterId: number, adopterId: number): Promise<AdopterNote[]> {
  const { rows } = await db.query<AdopterNote>(
    `SELECT ${NOTE} FROM "Adopter_note" WHERE shelter_id = $1 AND adopter_id = $2 ORDER BY created_at DESC, id DESC`,
    [shelterId, adopterId],
  );
  return rows;
}

export async function insertNote(db: Db, shelterId: number, adopterId: number, body: string): Promise<AdopterNote> {
  const { rows } = await db.query<AdopterNote>(
    `INSERT INTO "Adopter_note" (shelter_id, adopter_id, body) VALUES ($1, $2, $3) RETURNING ${NOTE}`,
    [shelterId, adopterId, body],
  );
  const note = rows[0];
  if (!note) throw new Error("insertNote: no row returned");
  return note;
}

/** Edits one of the shelter's notes about the adopter; null if there is no such note. */
export async function updateNote(db: Db, shelterId: number, adopterId: number, noteId: number, body: string): Promise<AdopterNote | null> {
  const { rows } = await db.query<AdopterNote>(
    `UPDATE "Adopter_note" SET body = $4, updated_at = now()
      WHERE id = $3 AND shelter_id = $1 AND adopter_id = $2
     RETURNING ${NOTE}`,
    [shelterId, adopterId, noteId, body],
  );
  return rows[0] ?? null;
}

/** Deletes one of the shelter's notes (notes have no history, so they are deleted). Returns whether it existed. */
export async function deleteNote(db: Db, shelterId: number, adopterId: number, noteId: number): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM "Adopter_note" WHERE id = $3 AND shelter_id = $1 AND adopter_id = $2`, [shelterId, adopterId, noteId]);
  return rowCount === 1;
}
