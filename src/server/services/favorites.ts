import { getConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import { NotFoundError } from "../errors.js";
import { isPetVisible, upsertFavorite } from "../models/discover.js";
import { deleteRating, selectDiscards, selectFavorites, type FavoritePet } from "../models/favorites.js";
import type { GalleryPet } from "../models/gallery.js";

export type { FavoritePet };

/** CU-12: the adopter's favourites. */
export async function listFavorites(adopterId: number): Promise<FavoritePet[]> {
  return selectFavorites(getPool(), adopterId);
}

/**
 * CU-12, RN-73: adds a pet to favourites from the gallery or its profile (same rating as in
 * discover mode). RN-74: it replaces a discard. Only pets visible to the adopter.
 */
export async function addFavorite(adopterId: number, petId: number): Promise<void> {
  await withTransaction(async (client) => {
    if (!(await isPetVisible(client, adopterId, petId))) throw new NotFoundError("Esta mascota no está disponible.");
    await upsertFavorite(client, adopterId, petId);
  });
}

/** CU-12, RN-76: removes a favourite, whatever the pet's status now. */
export async function removeFavorite(adopterId: number, petId: number): Promise<void> {
  if (!(await deleteRating(getPool(), adopterId, petId, "FAVORITE"))) throw new NotFoundError("Esta mascota no está en tus favoritos.");
}

/** CU-12: the discarded pets that can be recovered (discard still in force, RN-75). */
export async function listDiscards(adopterId: number): Promise<GalleryPet[]> {
  return selectDiscards(getPool(), adopterId, getConfig().rules.discardDurationDays);
}

/** CU-12, RN-76: recovers a discarded pet: the discard is deleted and it can show up again. */
export async function recoverDiscard(adopterId: number, petId: number): Promise<void> {
  if (!(await deleteRating(getPool(), adopterId, petId, "DISCARDED"))) throw new NotFoundError("Esta mascota no está descartada.");
}
