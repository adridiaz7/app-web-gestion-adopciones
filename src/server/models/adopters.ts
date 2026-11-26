import type { Db } from "../db/transaction.js";

export interface AdopterInsert {
  userId: number;
  firstName: string;
  lastName: string;
  phone: string;
  birthDate: string;
  provinceId: number;
  locality: string;
}

/** Household data (RN-27) is optional at sign-up, so it is left empty here. */
export async function insertAdopter(db: Db, adopter: AdopterInsert): Promise<void> {
  await db.query(
    `INSERT INTO "Adopter" (user_id, first_name, last_name, phone, birth_date, province_id, locality)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      adopter.userId,
      adopter.firstName,
      adopter.lastName,
      adopter.phone,
      adopter.birthDate,
      adopter.provinceId,
      adopter.locality,
    ],
  );
}

/** RN-27: the household data of the profile (all null until filled in). */
export interface Household {
  housingType: "APARTMENT" | "HOUSE" | "OTHER" | null;
  hasOutdoorSpace: boolean | null;
  housingTenure: "OWNED" | "RENTED" | "RENT_TO_OWN" | null;
  householdMembers: number | null;
  hasChildren: boolean | null;
  hasOtherPets: boolean | null;
  otherPetsDescription: string | null;
  hasPetExperience: boolean | null;
  hoursAlonePerDay: number | null;
}

/** With `forUpdate`, the adopter's row stays locked until the end of the transaction. */
export async function selectHousehold(db: Db, adopterId: number, forUpdate = false): Promise<Household | null> {
  const { rows } = await db.query<Household>(
    `SELECT housing_type AS "housingType", has_outdoor_space AS "hasOutdoorSpace", housing_tenure AS "housingTenure",
            household_members AS "householdMembers", has_children AS "hasChildren", has_other_pets AS "hasOtherPets",
            other_pets_description AS "otherPetsDescription", has_pet_experience AS "hasPetExperience",
            hours_alone_per_day AS "hoursAlonePerDay"
       FROM "Adopter" WHERE user_id = $1${forUpdate ? " FOR UPDATE" : ""}`,
    [adopterId],
  );
  return rows[0] ?? null;
}

/** RN-207: the household data corrected in the adoption form are saved in the profile. */
export async function updateHousehold(db: Db, adopterId: number, h: Household): Promise<void> {
  await db.query(
    `UPDATE "Adopter"
        SET housing_type = $2, has_outdoor_space = $3, housing_tenure = $4, household_members = $5, has_children = $6,
            has_other_pets = $7, other_pets_description = $8, has_pet_experience = $9, hours_alone_per_day = $10,
            updated_at = now()
      WHERE user_id = $1`,
    [
      adopterId,
      h.housingType,
      h.hasOutdoorSpace,
      h.housingTenure,
      h.householdMembers,
      h.hasChildren,
      h.hasOtherPets,
      h.otherPetsDescription,
      h.hasPetExperience,
      h.hoursAlonePerDay,
    ],
  );
}

/** CU-06: the personal data of the profile (the email lives in "App_user"). */
export interface AdopterPersonalData {
  firstName: string;
  lastName: string;
  phone: string;
  /** YYYY-MM-DD */
  birthDate: string;
  provinceId: number;
  locality: string;
}

export interface AdopterProfileRow extends AdopterPersonalData {
  email: string;
  household: Household;
}

/** CU-06: the adopter's own profile. With `forUpdate`, the row stays locked until the end of the transaction. */
export async function selectAdopterProfile(db: Db, adopterId: number, forUpdate = false): Promise<AdopterProfileRow | null> {
  const { rows } = await db.query<AdopterPersonalData & { email: string }>(
    `SELECT u.email, a.first_name AS "firstName", a.last_name AS "lastName", a.phone,
            to_char(a.birth_date, 'YYYY-MM-DD') AS "birthDate", a.province_id AS "provinceId", a.locality
       FROM "Adopter" a JOIN "App_user" u ON u.id = a.user_id
      WHERE a.user_id = $1${forUpdate ? " FOR UPDATE OF a" : ""}`,
    [adopterId],
  );
  const row = rows[0];
  if (!row) return null;
  const household = await selectHousehold(db, adopterId);
  if (!household) return null;
  return { ...row, household };
}

/** CU-06: updates the personal data of the profile. */
export async function updateAdopterPersonalData(db: Db, adopterId: number, p: AdopterPersonalData): Promise<void> {
  await db.query(
    `UPDATE "Adopter"
        SET first_name = $2, last_name = $3, phone = $4, birth_date = $5, province_id = $6, locality = $7, updated_at = now()
      WHERE user_id = $1`,
    [adopterId, p.firstName, p.lastName, p.phone, p.birthDate, p.provinceId, p.locality],
  );
}
