import type { Db } from "../db/transaction.js";
import { visiblePetCondition } from "./gallery.js";

/** The pet an alert is about. */
export interface AlertPet {
  name: string;
  shelterName: string;
}

export async function selectAlertPet(db: Db, petId: number): Promise<AlertPet | null> {
  const { rows } = await db.query<AlertPet>(
    `SELECT p.name, s.name AS "shelterName" FROM "Pet" p JOIN "Shelter" s ON s.user_id = p.shelter_id WHERE p.id = $1`,
    [petId],
  );
  return rows[0] ?? null;
}

/**
 * RN-200: the adopters (accounts not deleted) who have the pet in their favourites, except
 * `excluded`, and except those the shelter has blocked (they no longer see its pets, RN-148).
 */
export async function selectFavoriteAdopters(db: Db, petId: number, excluded: number[]): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT r.adopter_id AS id
       FROM adopter_pet_rel r
       JOIN "Pet" p ON p.id = r.pet_id
       JOIN "App_user" au ON au.id = r.adopter_id AND au.deleted_at IS NULL
      WHERE r.pet_id = $1 AND r.type = 'FAVORITE' AND NOT (r.adopter_id = ANY($2::bigint[]))
        AND NOT EXISTS (SELECT 1 FROM "Block" bl WHERE bl.shelter_id = p.shelter_id AND bl.adopter_id = r.adopter_id AND bl.lifted_at IS NULL)
      ORDER BY r.adopter_id`,
    [petId, excluded],
  );
  return rows.map((row) => row.id);
}

/**
 * RN-199, RN-71: the adopters who filled in the questionnaire, for whom the pet is visible
 * (available, shelter visible and not blocking them) and compatible, and who do not have it
 * in their favourites (they get the RN-200 alert instead). Same conditions as discover mode
 * (ERD §6), from the pet's side.
 */
export async function selectCompatibleAdopters(db: Db, petId: number, excluded: number[]): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT pr.adopter_id AS id
       FROM "Pet" p
       JOIN "Shelter"  s  ON s.user_id = p.shelter_id
       JOIN "App_user" su ON su.id = s.user_id
       JOIN "Breed"    br ON br.id = p.breed_id
      CROSS JOIN "Adopter_preferences" pr
       JOIN "App_user" au ON au.id = pr.adopter_id AND au.deleted_at IS NULL
      WHERE p.id = $1 AND NOT (pr.adopter_id = ANY($2::bigint[]))
        AND ${visiblePetCondition("pr.adopter_id")}
        AND (cardinality(pr.sizes) = 0           OR p.size = ANY(pr.sizes))
        AND (cardinality(pr.sexes) = 0           OR p.sex = ANY(pr.sexes))
        AND (cardinality(pr.activity_levels) = 0 OR p.activity_level = ANY(pr.activity_levels))
        AND (pr.min_age_months IS NULL OR p.birth_date <= current_date - make_interval(months => pr.min_age_months))
        AND (pr.max_age_months IS NULL OR p.birth_date >  current_date - make_interval(months => pr.max_age_months + 1))
        AND (NOT pr.needs_good_with_children OR p.good_with_children = 'YES')
        AND (NOT EXISTS (SELECT 1 FROM adopter_preferences_species_rel ws WHERE ws.adopter_id = pr.adopter_id AND ws.is_wanted)
             OR br.species_id IN (SELECT species_id FROM adopter_preferences_species_rel WHERE adopter_id = pr.adopter_id AND is_wanted))
        AND (NOT EXISTS (SELECT 1 FROM adopter_preferences_breed_rel pb WHERE pb.adopter_id = pr.adopter_id)
             OR p.breed_id IN (SELECT breed_id FROM adopter_preferences_breed_rel WHERE adopter_id = pr.adopter_id))
        AND NOT EXISTS (
             SELECT 1 FROM adopter_preferences_species_rel g
              WHERE g.adopter_id = pr.adopter_id AND g.must_get_along
                AND NOT EXISTS (SELECT 1 FROM pet_species_rel c
                                 WHERE c.pet_id = p.id AND c.species_id = g.species_id AND c.gets_along))
        AND NOT EXISTS (SELECT 1 FROM adopter_pet_rel r WHERE r.adopter_id = pr.adopter_id AND r.pet_id = p.id AND r.type = 'FAVORITE')
      ORDER BY pr.adopter_id`,
    [petId, excluded],
  );
  return rows.map((row) => row.id);
}

/** RN-23: the shelter's AVAILABLE pets (to announce them when it becomes visible). */
export async function selectAvailablePetIds(db: Db, shelterId: number): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(`SELECT id FROM "Pet" WHERE shelter_id = $1 AND status = 'AVAILABLE' ORDER BY id`, [shelterId]);
  return rows.map((row) => row.id);
}

