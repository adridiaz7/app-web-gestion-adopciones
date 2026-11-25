import type { Db } from "../db/transaction.js";
import { PET_CARD_COLUMNS, PET_CARD_FROM, visiblePetCondition, type GalleryPet } from "./gallery.js";

/**
 * RN-70, RN-71 (ERD §6 "Compatibilidad en el modo descubrir"), on the aliases of
 * PET_CARD_SELECT: $1 = adopter, $2 = days a discard lasts (RN-75). Without a
 * questionnaire everything is "me da igual" (RN-190).
 */
const DISCOVER_CONDITION = `${visiblePetCondition("$1")}
  AND (pr.adopter_id IS NULL OR (
        (cardinality(pr.sizes) = 0           OR p.size = ANY(pr.sizes))
    AND (cardinality(pr.sexes) = 0           OR p.sex = ANY(pr.sexes))
    AND (cardinality(pr.activity_levels) = 0 OR p.activity_level = ANY(pr.activity_levels))
    AND (pr.min_age_months IS NULL OR p.birth_date <= current_date - make_interval(months => pr.min_age_months))
    AND (pr.max_age_months IS NULL OR p.birth_date >  current_date - make_interval(months => pr.max_age_months + 1))
    AND (NOT pr.needs_good_with_children OR p.good_with_children = 'YES')
  ))
  AND (NOT EXISTS (SELECT 1 FROM adopter_preferences_species_rel ws WHERE ws.adopter_id = $1 AND ws.is_wanted)
       OR br.species_id IN (SELECT species_id FROM adopter_preferences_species_rel WHERE adopter_id = $1 AND is_wanted))
  AND (NOT EXISTS (SELECT 1 FROM adopter_preferences_breed_rel pb WHERE pb.adopter_id = $1)
       OR p.breed_id IN (SELECT breed_id FROM adopter_preferences_breed_rel WHERE adopter_id = $1))
  AND NOT EXISTS (
       SELECT 1 FROM adopter_preferences_species_rel g
        WHERE g.adopter_id = $1 AND g.must_get_along
          AND NOT EXISTS (SELECT 1 FROM pet_species_rel c
                           WHERE c.pet_id = p.id AND c.species_id = g.species_id AND c.gets_along))
  AND NOT EXISTS (
       SELECT 1 FROM adopter_pet_rel r
        WHERE r.adopter_id = $1 AND r.pet_id = p.id
          AND (r.type = 'FAVORITE' OR r.created_at > now() - make_interval(days => $2::int)))`;

export interface DiscoverCard {
  /** The pet to show, or null when there are none left. */
  pet: GalleryPet | null;
  /** How many compatible pets are left to rate, this one included. */
  remaining: number;
}

/**
 * CU-10: the next pet of discover mode, newest first; `firstPetId` (an undone discard,
 * RN-191) goes first when it is still a candidate.
 */
export async function selectDiscoverCard(db: Db, adopterId: number, discardDays: number, firstPetId: number | null): Promise<DiscoverCard> {
  // The window count runs before LIMIT, so it counts every candidate.
  const { rows } = await db.query<GalleryPet & { remaining: number }>(
    `SELECT count(*) OVER ()::int AS remaining, ${PET_CARD_COLUMNS} ${PET_CARD_FROM}
       LEFT JOIN "Adopter_preferences" pr ON pr.adopter_id = $1
      WHERE ${DISCOVER_CONDITION}
      ORDER BY (p.id = $3::bigint) IS TRUE DESC, p.created_at DESC, p.id DESC
      LIMIT 1`,
    [adopterId, discardDays, firstPetId],
  );
  const row = rows[0];
  if (!row) return { pet: null, remaining: 0 };
  const { remaining, ...pet } = row;
  return { pet, remaining };
}

export async function hasPreferences(db: Db, adopterId: number): Promise<boolean> {
  const { rowCount } = await db.query(`SELECT 1 FROM "Adopter_preferences" WHERE adopter_id = $1`, [adopterId]);
  return rowCount === 1;
}

/** RN-70: whether the pet is visible to the adopter (for rating it). Locks nothing. */
export async function isPetVisible(db: Db, adopterId: number, petId: number): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM "Pet" p
       JOIN "Shelter"  s  ON s.user_id = p.shelter_id
       JOIN "App_user" su ON su.id = s.user_id
      WHERE p.id = $2 AND ${visiblePetCondition("$1")}`,
    [adopterId, petId],
  );
  return rowCount === 1;
}

/** RN-72, RN-74: the pet becomes a favourite, replacing a discard if there was one. */
export async function upsertFavorite(db: Db, adopterId: number, petId: number): Promise<void> {
  await db.query(
    `INSERT INTO adopter_pet_rel (adopter_id, pet_id, type) VALUES ($1, $2, 'FAVORITE')
     ON CONFLICT (adopter_id, pet_id) DO UPDATE SET type = 'FAVORITE', created_at = now()
      WHERE adopter_pet_rel.type = 'DISCARDED'`,
    [adopterId, petId],
  );
}

/** RN-72, RN-75: discards the pet from now on (renewing an old discard). False if it is a favourite (RN-74). */
export async function upsertDiscard(db: Db, adopterId: number, petId: number): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO adopter_pet_rel (adopter_id, pet_id, type) VALUES ($1, $2, 'DISCARDED')
     ON CONFLICT (adopter_id, pet_id) DO UPDATE SET created_at = now()
      WHERE adopter_pet_rel.type = 'DISCARDED'`,
    [adopterId, petId],
  );
  return rowCount === 1;
}

/**
 * RN-191: deletes the discard of this pet only if it is the adopter's most recent one
 * (ERD: "el último descarte es el DISCARDED más reciente"). Ratings have no history (RN-76).
 */
export async function deleteLastDiscard(db: Db, adopterId: number, petId: number): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM adopter_pet_rel
      WHERE adopter_id = $1 AND pet_id = $2 AND type = 'DISCARDED'
        AND pet_id = (SELECT pet_id FROM adopter_pet_rel
                       WHERE adopter_id = $1 AND type = 'DISCARDED'
                       ORDER BY created_at DESC, pet_id DESC LIMIT 1)`,
    [adopterId, petId],
  );
  return rowCount === 1;
}
