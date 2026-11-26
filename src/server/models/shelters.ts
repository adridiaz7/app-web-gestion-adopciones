import type { Db } from "../db/transaction.js";

export interface ShelterInsert {
  userId: number;
  name: string;
  /** Already normalised by the controller (upper case, no spaces or hyphens). */
  cif: string;
  address: string;
  provinceId: number;
  locality: string;
  phone: string;
}

/** RN-17: whether a shelter already has this CIF. */
export async function cifExists(db: Db, cif: string): Promise<boolean> {
  const { rowCount } = await db.query(`SELECT 1 FROM "Shelter" WHERE cif = $1`, [cif]);
  return rowCount === 1;
}

/**
 * Inserts a shelter pending validation (RN-14, column default). Returns false when the
 * CIF is already taken (RN-17: unique constraint), so a concurrent sign-up with the same
 * CIF gets the same answer as one that was caught before.
 */
export async function insertShelterIfCifFree(db: Db, shelter: ShelterInsert): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO "Shelter" (user_id, name, cif, address, province_id, locality, phone)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (cif) DO NOTHING`,
    [
      shelter.userId,
      shelter.name,
      shelter.cif,
      shelter.address,
      shelter.provinceId,
      shelter.locality,
      shelter.phone,
    ],
  );
  return rowCount === 1;
}

export type ValidationStatus = "PENDING" | "VALIDATED" | "REJECTED";

export interface ShelterForAdmin {
  id: number;
  name: string;
  cif: string;
  email: string;
  phone: string;
  address: string;
  locality: string;
  provinceName: string;
  validationStatus: ValidationStatus;
  validationReason: string | null;
  registeredAt: Date;
  validatedAt: Date | null;
}

const SHELTER_FOR_ADMIN = `
  SELECT s.user_id AS id, s.name, s.cif, u.email, s.phone, s.address, s.locality, p.name AS "provinceName",
         s.validation_status AS "validationStatus", s.validation_reason AS "validationReason",
         u.created_at AS "registeredAt", s.validated_at AS "validatedAt"
    FROM "Shelter" s
    JOIN "App_user" u ON u.id = s.user_id
    JOIN "Province" p ON p.id = s.province_id
   WHERE u.deleted_at IS NULL`;

/** CU-39: shelters of an account not deleted, with that validation status, oldest sign-up first. */
export async function selectSheltersByStatus(db: Db, status: ValidationStatus): Promise<ShelterForAdmin[]> {
  const { rows } = await db.query<ShelterForAdmin>(
    `${SHELTER_FOR_ADMIN} AND s.validation_status = $1 ORDER BY u.created_at, s.user_id`,
    [status],
  );
  return rows;
}

export async function selectShelterForAdmin(db: Db, id: number): Promise<ShelterForAdmin | null> {
  const { rows } = await db.query<ShelterForAdmin>(`${SHELTER_FOR_ADMIN} AND s.user_id = $1`, [id]);
  return rows[0] ?? null;
}

/** The validation status of a shelter of an account not deleted, locked for the change. */
export async function lockShelterStatus(db: Db, id: number): Promise<ValidationStatus | null> {
  const { rows } = await db.query<{ status: ValidationStatus }>(
    `SELECT s.validation_status AS status
       FROM "Shelter" s JOIN "App_user" u ON u.id = s.user_id
      WHERE s.user_id = $1 AND u.deleted_at IS NULL
        FOR UPDATE OF s`,
    [id],
  );
  return rows[0]?.status ?? null;
}

export async function markShelterValidated(db: Db, id: number): Promise<void> {
  await db.query(
    `UPDATE "Shelter"
        SET validation_status = 'VALIDATED', validation_reason = NULL, validated_at = now(), updated_at = now()
      WHERE user_id = $1`,
    [id],
  );
}

/** RN-18, RN-19: rejected (a new request or a revoked validation), always with a reason. */
export async function markShelterRejected(db: Db, id: number, reason: string): Promise<void> {
  await db.query(
    `UPDATE "Shelter" SET validation_status = 'REJECTED', validation_reason = $2, updated_at = now() WHERE user_id = $1`,
    [id, reason],
  );
}

/** CU-06: the public data a shelter edits from its profile. */
export interface ShelterPublicData {
  description: string | null;
  address: string;
  provinceId: number;
  locality: string;
  phone: string;
  contactEmail: string | null;
  website: string | null;
  openingHours: string | null;
}

export interface ShelterOwnProfile extends ShelterPublicData {
  email: string;
  name: string;
  cif: string;
  logoUrl: string | null;
}

/** CU-06: the shelter's own profile. With `forUpdate`, the row stays locked until the end of the transaction. */
export async function selectShelterOwnProfile(db: Db, shelterId: number, forUpdate = false): Promise<ShelterOwnProfile | null> {
  const { rows } = await db.query<ShelterOwnProfile>(
    `SELECT u.email, s.name, s.cif, s.description, s.logo_path AS "logoUrl", s.address, s.province_id AS "provinceId",
            s.locality, s.phone, s.contact_email AS "contactEmail", s.website, s.opening_hours AS "openingHours"
       FROM "Shelter" s JOIN "App_user" u ON u.id = s.user_id
      WHERE s.user_id = $1${forUpdate ? " FOR UPDATE OF s" : ""}`,
    [shelterId],
  );
  return rows[0] ?? null;
}

/** CU-06: updates the public data of the shelter. */
export async function updateShelterPublicData(db: Db, shelterId: number, p: ShelterPublicData): Promise<void> {
  await db.query(
    `UPDATE "Shelter"
        SET description = $2, address = $3, province_id = $4, locality = $5, phone = $6, contact_email = $7,
            website = $8, opening_hours = $9, updated_at = now()
      WHERE user_id = $1`,
    [shelterId, p.description, p.address, p.provinceId, p.locality, p.phone, p.contactEmail, p.website, p.openingHours],
  );
}

/** CU-06, RN-52: sets (or clears, with null) the path of the shelter's logo. */
export async function updateShelterLogo(db: Db, shelterId: number, logoPath: string | null): Promise<void> {
  await db.query(`UPDATE "Shelter" SET logo_path = $2, updated_at = now() WHERE user_id = $1`, [shelterId, logoPath]);
}
