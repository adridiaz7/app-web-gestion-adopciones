import type { Db } from "../db/transaction.js";

/** The adopter's preferences questionnaire (CU-08). Empty lists and nulls mean "me da igual" (RN-34, RN-35). */
export interface Preferences {
  /** Wanted species. */
  speciesIds: number[];
  /** Wanted breeds. */
  breedIds: number[];
  sizes: ("SMALL" | "MEDIUM" | "LARGE")[];
  sexes: ("MALE" | "FEMALE")[];
  activityLevels: ("LOW" | "MEDIUM" | "HIGH")[];
  /** RN-205: age range in months, both ends optional. */
  minAgeMonths: number | null;
  maxAgeMonths: number | null;
  /** RN-36. */
  needsGoodWithChildren: boolean;
  /** RN-37: the pet must get along with every one of these species. */
  mustGetAlongWithSpeciesIds: number[];
}

/** The adopter's preferences, or null when they never filled in the questionnaire (RN-190). */
export async function selectPreferences(db: Db, adopterId: number): Promise<Preferences | null> {
  const { rows } = await db.query<Preferences>(
    `SELECT coalesce((SELECT array_agg(r.species_id::int ORDER BY r.species_id) FROM adopter_preferences_species_rel r
                       WHERE r.adopter_id = pr.adopter_id AND r.is_wanted), '{}') AS "speciesIds",
            coalesce((SELECT array_agg(b.breed_id ORDER BY b.breed_id) FROM adopter_preferences_breed_rel b
                       WHERE b.adopter_id = pr.adopter_id), '{}') AS "breedIds",
            pr.sizes, pr.sexes, pr.activity_levels AS "activityLevels",
            pr.min_age_months AS "minAgeMonths", pr.max_age_months AS "maxAgeMonths",
            pr.needs_good_with_children AS "needsGoodWithChildren",
            coalesce((SELECT array_agg(r.species_id::int ORDER BY r.species_id) FROM adopter_preferences_species_rel r
                       WHERE r.adopter_id = pr.adopter_id AND r.must_get_along), '{}') AS "mustGetAlongWithSpeciesIds"
       FROM "Adopter_preferences" pr
      WHERE pr.adopter_id = $1`,
    [adopterId],
  );
  return rows[0] ?? null;
}

/** Locks the adopter's row, so two saves of the questionnaire do not interleave. */
export async function lockAdopter(db: Db, adopterId: number): Promise<void> {
  await db.query(`SELECT 1 FROM "Adopter" WHERE user_id = $1 FOR UPDATE`, [adopterId]);
}

/** Creates or replaces the adopter's preferences and their species and breed rows. */
export async function savePreferences(db: Db, adopterId: number, prefs: Preferences): Promise<void> {
  await db.query(
    `INSERT INTO "Adopter_preferences" (adopter_id, sizes, sexes, activity_levels, min_age_months, max_age_months,
                                        needs_good_with_children, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (adopter_id) DO UPDATE
        SET sizes = EXCLUDED.sizes, sexes = EXCLUDED.sexes, activity_levels = EXCLUDED.activity_levels,
            min_age_months = EXCLUDED.min_age_months, max_age_months = EXCLUDED.max_age_months,
            needs_good_with_children = EXCLUDED.needs_good_with_children, updated_at = now()`,
    [adopterId, prefs.sizes, prefs.sexes, prefs.activityLevels, prefs.minAgeMonths, prefs.maxAgeMonths, prefs.needsGoodWithChildren],
  );

  // Join-table rows have no history: they are replaced.
  await db.query(`DELETE FROM adopter_preferences_species_rel WHERE adopter_id = $1`, [adopterId]);
  await db.query(
    `INSERT INTO adopter_preferences_species_rel (adopter_id, species_id, is_wanted, must_get_along)
     SELECT $1, s.id, s.id = ANY($2::smallint[]), s.id = ANY($3::smallint[])
       FROM unnest($2::smallint[] || $3::smallint[]) AS u(id)
       JOIN "Species" s ON s.id = u.id
      GROUP BY s.id`,
    [adopterId, prefs.speciesIds, prefs.mustGetAlongWithSpeciesIds],
  );

  await db.query(`DELETE FROM adopter_preferences_breed_rel WHERE adopter_id = $1`, [adopterId]);
  await db.query(
    `INSERT INTO adopter_preferences_breed_rel (adopter_id, breed_id) SELECT $1, unnest($2::int[])`,
    [adopterId, prefs.breedIds],
  );
}

/** RN-38: deletes every discard of the adopter; favourites stay. */
export async function deleteDiscards(db: Db, adopterId: number): Promise<void> {
  await db.query(`DELETE FROM adopter_pet_rel WHERE adopter_id = $1 AND type = 'DISCARDED'`, [adopterId]);
}

/** How many of these breed ids exist. */
export async function countBreeds(db: Db, ids: number[]): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "Breed" WHERE id = ANY($1::int[])`, [ids]);
  return rows[0]?.n ?? 0;
}
