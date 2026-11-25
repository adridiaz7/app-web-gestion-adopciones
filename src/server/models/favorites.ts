import type { Db } from "../db/transaction.js";
import type { PetStatus } from "./pets.js";
import { PET_CARD_COLUMNS, PET_CARD_FROM, visiblePetCondition, visibleShelterCondition, type GalleryPet } from "./gallery.js";

export interface FavoritePet extends GalleryPet {
  /** Favourites keep their pet's status (reserved, adopted…), so the adopter can follow it. */
  status: PetStatus;
}

/**
 * CU-12: the adopter's favourites, most recent first, with their status. Pets of shelters
 * that are not visible to the adopter are left out (RN-23, RN-77).
 */
export async function selectFavorites(db: Db, adopterId: number): Promise<FavoritePet[]> {
  const { rows } = await db.query<FavoritePet>(
    `SELECT ${PET_CARD_COLUMNS}, p.status ${PET_CARD_FROM}
       JOIN adopter_pet_rel r ON r.pet_id = p.id AND r.adopter_id = $1 AND r.type = 'FAVORITE'
      WHERE ${visibleShelterCondition("$1")}
      ORDER BY r.created_at DESC, p.id DESC`,
    [adopterId],
  );
  return rows;
}

/** CU-12, RN-75: the discards still in force of visible pets, most recent first. $2 = days a discard lasts. */
export async function selectDiscards(db: Db, adopterId: number, discardDays: number): Promise<GalleryPet[]> {
  const { rows } = await db.query<GalleryPet>(
    `SELECT ${PET_CARD_COLUMNS} ${PET_CARD_FROM}
       JOIN adopter_pet_rel r ON r.pet_id = p.id AND r.adopter_id = $1 AND r.type = 'DISCARDED'
      WHERE r.created_at > now() - make_interval(days => $2::int)
        AND ${visiblePetCondition("$1")}
      ORDER BY r.created_at DESC, p.id DESC`,
    [adopterId, discardDays],
  );
  return rows;
}

/** RN-76: deletes a rating of this type (no history). False if there was none. */
export async function deleteRating(db: Db, adopterId: number, petId: number, type: "FAVORITE" | "DISCARDED"): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM adopter_pet_rel WHERE adopter_id = $1 AND pet_id = $2 AND type = $3`, [
    adopterId,
    petId,
    type,
  ]);
  return rowCount === 1;
}
