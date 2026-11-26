import { getPool } from "../db/pool.js";
import type { Db } from "../db/transaction.js";
import { NotFoundError } from "../errors.js";
import { deleteNote, insertNote, selectNotes, updateNote, type AdopterNote } from "../models/adopter-notes.js";
import { selectAdopterForShelter } from "../models/shelter-adopters.js";

export type { AdopterNote };

const NOTE_NOT_FOUND = "La nota no existe.";

/** RN-204, RN-29: only about adopters who have sent this shelter some request. */
async function ensureKnownAdopter(db: Db, shelterId: number, adopterId: number): Promise<void> {
  if (!(await selectAdopterForShelter(db, shelterId, adopterId))) throw new NotFoundError("El adoptante no existe.");
}

/** CU-52: the shelter's internal notes about the adopter, newest first. Only that shelter sees them (RN-204). */
export async function listAdopterNotes(shelterId: number, adopterId: number): Promise<AdopterNote[]> {
  const pool = getPool();
  await ensureKnownAdopter(pool, shelterId, adopterId);
  return selectNotes(pool, shelterId, adopterId);
}

/** CU-52: writes a note (already trimmed and not empty), with its date (RN-204). */
export async function addAdopterNote(shelterId: number, adopterId: number, body: string): Promise<AdopterNote> {
  const pool = getPool();
  await ensureKnownAdopter(pool, shelterId, adopterId);
  return insertNote(pool, shelterId, adopterId, body);
}

/** CU-52: edits one of the shelter's notes. */
export async function editAdopterNote(shelterId: number, adopterId: number, noteId: number, body: string): Promise<AdopterNote> {
  const note = await updateNote(getPool(), shelterId, adopterId, noteId, body);
  if (!note) throw new NotFoundError(NOTE_NOT_FOUND);
  return note;
}

/** CU-52: deletes one of the shelter's notes. */
export async function removeAdopterNote(shelterId: number, adopterId: number, noteId: number): Promise<void> {
  if (!(await deleteNote(getPool(), shelterId, adopterId, noteId))) throw new NotFoundError(NOTE_NOT_FOUND);
}
