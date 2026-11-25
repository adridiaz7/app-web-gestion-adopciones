import type { Db } from "../db/transaction.js";

export interface PetPhoto {
  id: number;
  /** Public path of the file, under /uploads (RN-52). */
  url: string;
  /** 1 is the main photo (RN-51). */
  position: number;
}

/** The pet's photos in order (RN-51). */
export async function selectPetPhotos(db: Db, petId: number): Promise<PetPhoto[]> {
  const { rows } = await db.query<PetPhoto>(
    `SELECT id, path AS url, position FROM "Pet_photo" WHERE pet_id = $1 ORDER BY position`,
    [petId],
  );
  return rows;
}

export async function insertPetPhoto(db: Db, petId: number, path: string, position: number): Promise<void> {
  await db.query(`INSERT INTO "Pet_photo" (pet_id, path, position) VALUES ($1, $2, $3)`, [petId, path, position]);
}

/** Photos have no history, so they are deleted physically. Returns the path of the deleted photo. */
export async function deletePetPhoto(db: Db, petId: number, photoId: number): Promise<string | null> {
  const { rows } = await db.query<{ path: string }>(
    `DELETE FROM "Pet_photo" WHERE id = $1 AND pet_id = $2 RETURNING path`,
    [photoId, petId],
  );
  return rows[0]?.path ?? null;
}

/**
 * RN-51: gives the photos positions 1, 2, 3… in the order of `photoIds`. The unique
 * (pet_id, position) constraint is deferred, so the swap is checked at commit.
 */
export async function setPhotoPositions(db: Db, petId: number, photoIds: number[]): Promise<void> {
  await db.query(
    `UPDATE "Pet_photo" p SET position = o.position
       FROM unnest($2::bigint[]) WITH ORDINALITY AS o(id, position)
      WHERE p.id = o.id AND p.pet_id = $1`,
    [petId, photoIds],
  );
}
