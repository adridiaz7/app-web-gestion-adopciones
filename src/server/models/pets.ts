import type { Db } from "../db/transaction.js";

export type PetStatus = "AVAILABLE" | "RESERVED" | "ADOPTED" | "UNLISTED";

export interface GetsAlong {
  speciesId: number;
  getsAlong: boolean;
}

/** The data of a pet's profile that the shelter fills in (CU-15, CU-16). */
export interface PetData {
  breedId: number;
  name: string;
  description: string;
  /** YYYY-MM-DD, approximate (RN-43). */
  birthDate: string;
  sex: "MALE" | "FEMALE";
  size: "SMALL" | "MEDIUM" | "LARGE";
  activityLevel: "LOW" | "MEDIUM" | "HIGH";
  goodWithChildren: "YES" | "NO" | "UNKNOWN";
  /** RN-46: one entry per species; a species without an entry is unknown. */
  getsAlongWith: GetsAlong[];
  vaccinated: boolean;
  dewormed: boolean;
  sterilized: boolean;
  microchipped: boolean;
  specialNeeds: string | null;
}

export interface ShelterPet extends PetData {
  id: number;
  speciesId: number;
  speciesName: string;
  breedName: string;
  status: PetStatus;
  /** RN-62: only for an UNLISTED pet. */
  unlistReason: UnlistReason | null;
  unlistedAt: Date | null;
  createdAt: Date;
}

export async function breedExists(db: Db, id: number): Promise<boolean> {
  const { rowCount } = await db.query(`SELECT 1 FROM "Breed" WHERE id = $1`, [id]);
  return rowCount === 1;
}

/** How many of these species ids exist. */
export async function countSpecies(db: Db, ids: number[]): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "Species" WHERE id = ANY($1::smallint[])`, [ids]);
  return rows[0]?.n ?? 0;
}

/** RN-53: a new pet is available (column default). */
export async function insertPet(db: Db, shelterId: number, pet: PetData): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO "Pet" (shelter_id, breed_id, name, description, birth_date, sex, size, activity_level,
                        good_with_children, vaccinated, dewormed, sterilized, microchipped, special_needs)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      shelterId,
      pet.breedId,
      pet.name,
      pet.description,
      pet.birthDate,
      pet.sex,
      pet.size,
      pet.activityLevel,
      pet.goodWithChildren,
      pet.vaccinated,
      pet.dewormed,
      pet.sterilized,
      pet.microchipped,
      pet.specialNeeds,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("insertPet: no row returned");
  return row.id;
}

export async function updatePet(db: Db, petId: number, pet: PetData): Promise<void> {
  await db.query(
    `UPDATE "Pet"
        SET breed_id = $2, name = $3, description = $4, birth_date = $5, sex = $6, size = $7, activity_level = $8,
            good_with_children = $9, vaccinated = $10, dewormed = $11, sterilized = $12, microchipped = $13,
            special_needs = $14, updated_at = now()
      WHERE id = $1`,
    [
      petId,
      pet.breedId,
      pet.name,
      pet.description,
      pet.birthDate,
      pet.sex,
      pet.size,
      pet.activityLevel,
      pet.goodWithChildren,
      pet.vaccinated,
      pet.dewormed,
      pet.sterilized,
      pet.microchipped,
      pet.specialNeeds,
    ],
  );
}

/** RN-46: replaces the "gets along with" rows of the pet (join-table rows: no history). */
export async function replaceGetsAlong(db: Db, petId: number, list: GetsAlong[]): Promise<void> {
  await db.query(`DELETE FROM pet_species_rel WHERE pet_id = $1`, [petId]);
  for (const item of list) {
    await db.query(`INSERT INTO pet_species_rel (pet_id, species_id, gets_along) VALUES ($1, $2, $3)`, [
      petId,
      item.speciesId,
      item.getsAlong,
    ]);
  }
}

const SHELTER_PET = `
  SELECT p.id, p.breed_id AS "breedId", b.name AS "breedName", s.id AS "speciesId", s.name AS "speciesName",
         p.name, p.description, to_char(p.birth_date, 'YYYY-MM-DD') AS "birthDate", p.sex, p.size,
         p.activity_level AS "activityLevel", p.good_with_children AS "goodWithChildren",
         p.vaccinated, p.dewormed, p.sterilized, p.microchipped, p.special_needs AS "specialNeeds",
         p.status, p.unlist_reason AS "unlistReason", p.unlisted_at AS "unlistedAt", p.created_at AS "createdAt",
         coalesce((SELECT json_agg(json_build_object('speciesId', r.species_id, 'getsAlong', r.gets_along) ORDER BY r.species_id)
                     FROM pet_species_rel r WHERE r.pet_id = p.id), '[]'::json) AS "getsAlongWith"
    FROM "Pet" p
    JOIN "Breed" b ON b.id = p.breed_id
    JOIN "Species" s ON s.id = b.species_id
   WHERE p.shelter_id = $1`;

/** CU-14: the shelter's pets, newest first. */
export async function selectShelterPets(db: Db, shelterId: number): Promise<ShelterPet[]> {
  const { rows } = await db.query<ShelterPet>(`${SHELTER_PET} ORDER BY p.created_at DESC, p.id DESC`, [shelterId]);
  return rows;
}

/** A pet of this shelter, or null if it does not exist or belongs to another shelter. */
export async function selectShelterPet(db: Db, shelterId: number, petId: number, lock = false): Promise<ShelterPet | null> {
  const { rows } = await db.query<ShelterPet>(`${SHELTER_PET} AND p.id = $2${lock ? " FOR UPDATE OF p" : ""}`, [shelterId, petId]);
  return rows[0] ?? null;
}

/** RN-62: the reasons a pet can be unlisted with. REMOVED_BY_ADMIN is only for the administrator. */
export type UnlistReason = "DECEASED" | "TRANSFERRED" | "TREATMENT" | "FOSTER" | "ERROR" | "OTHER" | "REMOVED_BY_ADMIN";

/** RN-60: the pet stays in the database, hidden from adopters. */
export async function markPetUnlisted(db: Db, petId: number, reason: UnlistReason): Promise<void> {
  await db.query(`UPDATE "Pet" SET status = 'UNLISTED', unlist_reason = $2, unlisted_at = now(), updated_at = now() WHERE id = $1`, [petId, reason]);
}

/** RN-63: the pet is available again. */
export async function markPetReactivated(db: Db, petId: number): Promise<void> {
  await db.query(`UPDATE "Pet" SET status = 'AVAILABLE', unlist_reason = NULL, unlisted_at = NULL, updated_at = now() WHERE id = $1`, [petId]);
}

/** CU-41: the status of any pet, locked; null if it does not exist. */
export async function lockPetStatus(db: Db, petId: number): Promise<string | null> {
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM "Pet" WHERE id = $1 FOR UPDATE`, [petId]);
  return rows[0]?.status ?? null;
}
