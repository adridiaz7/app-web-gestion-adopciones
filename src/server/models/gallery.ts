import type { Db } from "../db/transaction.js";

/**
 * "Pet visible to an adopter" (ERD §6; RN-58, RN-23, RN-24, RN-77), on the aliases
 * p = "Pet", s = "Shelter", su = the shelter's "App_user". `adopterParam` is the
 * placeholder of the adopter's id, or of NULL for a visitor (no block to check).
 */
export function visiblePetCondition(adopterParam: string): string {
  return `p.status = 'AVAILABLE' AND ${visibleShelterCondition(adopterParam)}`;
}

/**
 * The shelter part of the visibility (RN-23, RN-77): validated, not suspended, not deleted,
 * and not blocking the adopter. Same aliases and placeholder as visiblePetCondition.
 */
export function visibleShelterCondition(adopterParam: string): string {
  return `s.validation_status = 'VALIDATED'
      AND su.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM "Suspension" sp WHERE sp.user_id = p.shelter_id AND sp.ended_at IS NULL)
      AND (${adopterParam}::bigint IS NULL OR NOT EXISTS (
            SELECT 1 FROM "Block" bl
             WHERE bl.shelter_id = p.shelter_id AND bl.adopter_id = ${adopterParam}::bigint AND bl.lifted_at IS NULL))`;
}

/** RN-189, RN-205: all optional; an absent filter means "any". */
export interface GalleryFilters {
  speciesId?: number | undefined;
  breedId?: number | undefined;
  size?: "SMALL" | "MEDIUM" | "LARGE" | undefined;
  sex?: "MALE" | "FEMALE" | undefined;
  provinceId?: number | undefined;
  minAgeMonths?: number | undefined;
  maxAgeMonths?: number | undefined;
  /** Only the pets of this shelter (its profile, CU-13). Not a gallery filter of the API. */
  shelterId?: number | undefined;
}

/** The data of a gallery card (RN-187). */
export interface GalleryPet {
  id: number;
  name: string;
  speciesName: string;
  breedName: string;
  /** YYYY-MM-DD; the age is shown from it (RN-205). */
  birthDate: string;
  sex: "MALE" | "FEMALE";
  size: "SMALL" | "MEDIUM" | "LARGE";
  /** The main photo (RN-51), or null without photos. */
  photoUrl: string | null;
  shelterName: string;
  provinceName: string;
}

/** Columns of a pet card (GalleryPet). */
export const PET_CARD_COLUMNS = `p.id, p.name, sc.name AS "speciesName", br.name AS "breedName",
            to_char(p.birth_date, 'YYYY-MM-DD') AS "birthDate", p.sex, p.size,
            ph.path AS "photoUrl", s.name AS "shelterName", pv.name AS "provinceName"`;

/** Joins of a pet card, with the aliases used by visiblePetCondition. */
export const PET_CARD_FROM = `
       FROM "Pet" p
       JOIN "Shelter"  s  ON s.user_id = p.shelter_id
       JOIN "App_user" su ON su.id = s.user_id
       JOIN "Breed"    br ON br.id = p.breed_id
       JOIN "Species"  sc ON sc.id = br.species_id
       JOIN "Province" pv ON pv.id = s.province_id
       LEFT JOIN "Pet_photo" ph ON ph.pet_id = p.id AND ph.position = 1`;

/** CU-09: the visible pets that match the filters, newest first. */
export async function selectGalleryPets(db: Db, adopterId: number | null, filters: GalleryFilters): Promise<GalleryPet[]> {
  const { rows } = await db.query<GalleryPet>(
    `SELECT ${PET_CARD_COLUMNS} ${PET_CARD_FROM}
      WHERE ${visiblePetCondition("$1")}
        AND ($2::smallint IS NULL OR br.species_id = $2)
        AND ($3::int      IS NULL OR p.breed_id = $3)
        AND ($4::text     IS NULL OR p.size = $4)
        AND ($5::text     IS NULL OR p.sex = $5)
        AND ($6::smallint IS NULL OR s.province_id = $6)
        AND ($7::int      IS NULL OR p.birth_date <= current_date - make_interval(months => $7::int))
        AND ($8::int      IS NULL OR p.birth_date >  current_date - make_interval(months => $8::int + 1))
        AND ($9::bigint   IS NULL OR p.shelter_id = $9)
      ORDER BY p.created_at DESC, p.id DESC`,
    [
      adopterId,
      filters.speciesId ?? null,
      filters.breedId ?? null,
      filters.size ?? null,
      filters.sex ?? null,
      filters.provinceId ?? null,
      filters.minAgeMonths ?? null,
      filters.maxAgeMonths ?? null,
      filters.shelterId ?? null,
    ],
  );
  return rows;
}

/** The whole profile of a pet (CU-11). */
export interface PetProfile {
  id: number;
  name: string;
  description: string;
  speciesName: string;
  breedName: string;
  /** YYYY-MM-DD; the age is shown from it (RN-205). */
  birthDate: string;
  sex: "MALE" | "FEMALE";
  size: "SMALL" | "MEDIUM" | "LARGE";
  activityLevel: "LOW" | "MEDIUM" | "HIGH";
  goodWithChildren: "YES" | "NO" | "UNKNOWN";
  /** RN-46: only the species with a record; any other is unknown. */
  getsAlongWith: { speciesName: string; getsAlong: boolean }[];
  vaccinated: boolean;
  dewormed: boolean;
  sterilized: boolean;
  microchipped: boolean;
  specialNeeds: string | null;
  /** In order; the first is the main one (RN-51). */
  photos: { id: number; url: string; position: number }[];
  shelter: { id: number; name: string; locality: string; provinceName: string };
}

/** CU-11: a pet's profile, or null when it is not visible to this viewer (ERD §6). */
export async function selectVisiblePet(db: Db, adopterId: number | null, petId: number): Promise<PetProfile | null> {
  const { rows } = await db.query<PetProfile>(
    `SELECT p.id, p.name, p.description, sc.name AS "speciesName", br.name AS "breedName",
            to_char(p.birth_date, 'YYYY-MM-DD') AS "birthDate", p.sex, p.size,
            p.activity_level AS "activityLevel", p.good_with_children AS "goodWithChildren",
            coalesce((SELECT json_agg(json_build_object('speciesName', rs.name, 'getsAlong', r.gets_along) ORDER BY rs.name)
                        FROM pet_species_rel r JOIN "Species" rs ON rs.id = r.species_id
                       WHERE r.pet_id = p.id), '[]'::json) AS "getsAlongWith",
            p.vaccinated, p.dewormed, p.sterilized, p.microchipped, p.special_needs AS "specialNeeds",
            coalesce((SELECT json_agg(json_build_object('id', ph.id, 'url', ph.path, 'position', ph.position) ORDER BY ph.position)
                        FROM "Pet_photo" ph WHERE ph.pet_id = p.id), '[]'::json) AS photos,
            json_build_object('id', s.user_id, 'name', s.name, 'locality', s.locality, 'provinceName', pv.name) AS shelter
       FROM "Pet" p
       JOIN "Shelter"  s  ON s.user_id = p.shelter_id
       JOIN "App_user" su ON su.id = s.user_id
       JOIN "Breed"    br ON br.id = p.breed_id
       JOIN "Species"  sc ON sc.id = br.species_id
       JOIN "Province" pv ON pv.id = s.province_id
      WHERE p.id = $2 AND ${visiblePetCondition("$1")}`,
    [adopterId, petId],
  );
  return rows[0] ?? null;
}
