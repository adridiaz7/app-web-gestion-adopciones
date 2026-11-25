import { getConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { withTransaction, type Db } from "../db/transaction.js";
import { ConflictError, NotFoundError } from "../errors.js";
import {
  deleteLastDiscard,
  hasPreferences,
  isPetVisible,
  selectDiscoverCard,
  upsertDiscard,
  upsertFavorite,
  type DiscoverCard,
} from "../models/discover.js";

export interface DiscoverState extends DiscoverCard {
  /** RN-190: false = no questionnaire: every available pet is shown, with an invitation to fill it in. */
  hasPreferences: boolean;
}

async function stateOf(db: Db, adopterId: number, firstPetId: number | null = null): Promise<DiscoverState> {
  const card = await selectDiscoverCard(db, adopterId, getConfig().rules.discardDurationDays, firstPetId);
  return { ...card, hasPreferences: await hasPreferences(db, adopterId) };
}

/** CU-10: the next compatible pet to rate (RN-70, RN-71). */
export async function getDiscoverState(adopterId: number): Promise<DiscoverState> {
  return stateOf(getPool(), adopterId);
}

/** RN-70: only pets visible to the adopter can be rated. */
async function ensureVisible(db: Db, adopterId: number, petId: number): Promise<void> {
  if (!(await isPetVisible(db, adopterId, petId))) throw new NotFoundError("Esta mascota no está disponible.");
}

/** CU-10, RN-72: adds the pet to favourites (replacing an old discard, RN-74) and returns the next one. */
export async function favoritePet(adopterId: number, petId: number): Promise<DiscoverState> {
  return withTransaction(async (client) => {
    await ensureVisible(client, adopterId, petId);
    await upsertFavorite(client, adopterId, petId);
    return stateOf(client, adopterId);
  });
}

/** CU-10, RN-72, RN-75: discards the pet for the configured days and returns the next one. */
export async function discardPet(adopterId: number, petId: number): Promise<DiscoverState> {
  return withTransaction(async (client) => {
    await ensureVisible(client, adopterId, petId);
    // RN-74: one rating per pet; a favourite is removed from the favourites list, not discarded.
    if (!(await upsertDiscard(client, adopterId, petId))) throw new ConflictError("Esta mascota ya está en tus favoritos.");
    return stateOf(client, adopterId);
  });
}

/** CU-10, RN-191: undoes the last discard; the pet is shown again first. */
export async function undoLastDiscard(adopterId: number, petId: number): Promise<DiscoverState> {
  return withTransaction(async (client) => {
    if (!(await deleteLastDiscard(client, adopterId, petId))) {
      throw new ConflictError("No hay un descarte inmediatamente anterior que deshacer.");
    }
    return stateOf(client, adopterId, petId);
  });
}
