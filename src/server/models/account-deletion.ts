import type { Db } from "../db/transaction.js";

/** The account that asks to be deleted, locked for the rest of the transaction. */
export interface AccountToDelete {
  role: "ADOPTER" | "SHELTER" | "ADMIN";
  passwordHash: string;
}

export async function lockAccount(db: Db, userId: number): Promise<AccountToDelete | null> {
  const { rows } = await db.query<AccountToDelete>(
    `SELECT role, password_hash AS "passwordHash" FROM "App_user" WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [userId],
  );
  return rows[0] ?? null;
}

/** A visit or adoption voided because an account was deleted, with whom to tell. */
export interface VoidedByDeletion {
  id: number;
  adopterId: number;
  shelterId: number;
  petId: number;
  petName: string;
  previousStatus: string;
}

export interface VoidedVisit extends VoidedByDeletion {
  startsAt: Date;
}

/** Why a whole account's visits and adoptions are voided: RN-12 (deleted) or RN-158 (suspended adopter). */
export type AccountVoidReason = "ACCOUNT_DELETED" | "ADOPTER_SUSPENDED";

/** RN-12, RN-158: the open (PENDING or CONFIRMED) visits of the adopter, or of the shelter, become VOIDED with `reason`. */
export async function voidOpenVisitsOf(db: Db, column: "adopter_id" | "shelter_id", userId: number, reason: AccountVoidReason = "ACCOUNT_DELETED"): Promise<VoidedVisit[]> {
  const { rows } = await db.query<VoidedVisit>(
    `WITH open AS (
       SELECT id, status FROM "Visit" WHERE ${column} = $1 AND status IN ('PENDING', 'CONFIRMED') FOR UPDATE
     )
     UPDATE "Visit" v SET status = 'VOIDED', void_reason = $2, voided_at = now()
       FROM open, "Pet" p, "Visit_slot" vs
      WHERE v.id = open.id AND p.id = v.pet_id AND vs.id = v.slot_id
     RETURNING v.id, v.adopter_id AS "adopterId", v.shelter_id AS "shelterId", v.pet_id AS "petId", p.name AS "petName",
               vs.starts_at AS "startsAt", open.status AS "previousStatus"`,
    [userId, reason],
  );
  return rows.sort((a, b) => a.id - b.id);
}

/**
 * RN-12, RN-158: the adoptions of the adopter, or of the shelter's pets, in `statuses` (by
 * default the open ones, PENDING and APPROVED) become VOIDED with `reason`.
 */
export async function voidOpenAdoptionsOf(
  db: Db,
  column: "adopter_id" | "shelter_id",
  userId: number,
  reason: AccountVoidReason = "ACCOUNT_DELETED",
  statuses: readonly ("PENDING" | "APPROVED")[] = ["PENDING", "APPROVED"],
): Promise<VoidedByDeletion[]> {
  const where = column === "adopter_id" ? "a.adopter_id = $1" : "p.shelter_id = $1";
  const { rows } = await db.query<VoidedByDeletion>(
    `WITH open AS (
       SELECT a.id, a.status FROM "Adoption" a JOIN "Pet" p ON p.id = a.pet_id
        WHERE ${where} AND a.status = ANY($3::text[]) FOR UPDATE OF a
     )
     UPDATE "Adoption" a SET status = 'VOIDED', void_reason = $2, voided_at = now()
       FROM open, "Pet" p
      WHERE a.id = open.id AND p.id = a.pet_id
     RETURNING a.id, a.adopter_id AS "adopterId", p.shelter_id AS "shelterId", a.pet_id AS "petId", p.name AS "petName", open.status AS "previousStatus"`,
    [userId, reason, statuses],
  );
  return rows.sort((a, b) => a.id - b.id);
}

/** RN-12, decision of 26/11/2026: the shelter's AVAILABLE and RESERVED pets become UNLISTED (ACCOUNT_DELETED). */
export async function unlistShelterPets(db: Db, shelterId: number): Promise<{ id: number; previousStatus: string }[]> {
  const { rows } = await db.query<{ id: number; previousStatus: string }>(
    `WITH open AS (
       SELECT id, status FROM "Pet" WHERE shelter_id = $1 AND status IN ('AVAILABLE', 'RESERVED') FOR UPDATE
     )
     UPDATE "Pet" p SET status = 'UNLISTED', unlist_reason = 'ACCOUNT_DELETED', unlisted_at = now(), updated_at = now()
       FROM open WHERE p.id = open.id
     RETURNING p.id, open.status AS "previousStatus"`,
    [shelterId],
  );
  return rows.sort((a, b) => a.id - b.id);
}

/** RN-11, RN-12: the adopter's personal and household data are anonymised. */
export async function anonymiseAdopter(db: Db, adopterId: number, name: string): Promise<void> {
  await db.query(
    `UPDATE "Adopter"
        SET first_name = $2, last_name = '', phone = '', locality = '', birth_date = DATE '1900-01-01',
            housing_type = NULL, has_outdoor_space = NULL, housing_tenure = NULL, household_members = NULL,
            has_children = NULL, has_other_pets = NULL, other_pets_description = NULL,
            has_pet_experience = NULL, hours_alone_per_day = NULL, updated_at = now()
      WHERE user_id = $1`,
    [adopterId, name],
  );
}

/** RN-11, RN-12: the shelter's contact and public data are anonymised; the CIF gets a unique placeholder. */
export async function anonymiseShelter(db: Db, shelterId: number, name: string): Promise<void> {
  await db.query(
    `UPDATE "Shelter"
        SET name = $2, cif = 'DELETED-' || $1::text, description = NULL, logo_path = NULL, address = '',
            locality = '', phone = '', contact_email = NULL, website = NULL, opening_hours = NULL, updated_at = now()
      WHERE user_id = $1`,
    [shelterId, name],
  );
}

/** RN-11: the account keeps its row (history) with a unique placeholder email and an unusable password. */
export async function markAccountDeleted(db: Db, userId: number): Promise<void> {
  await db.query(
    `UPDATE "App_user"
        SET email = 'deleted-' || $1::text || '@deleted.invalid', password_hash = '!deleted', deleted_at = now(), updated_at = now()
      WHERE id = $1`,
    [userId],
  );
}

/** RN-210: the audit entries about the account or its profile. */
export async function selectProfileAuditDetails(db: Db, userId: number, profileType: "Adopter" | "Shelter"): Promise<{ id: number; details: unknown }[]> {
  const { rows } = await db.query<{ id: number; details: unknown }>(
    `SELECT id, details FROM "Audit_log" WHERE entity_id = $1 AND entity_type IN ($2, 'App_user') ORDER BY id`,
    [userId, profileType],
  );
  return rows;
}

/** RN-210: the only change allowed on the audit log. */
export async function updateAuditDetails(db: Db, id: number, details: unknown): Promise<void> {
  await db.query(`UPDATE "Audit_log" SET details = $2 WHERE id = $1`, [id, JSON.stringify(details)]);
}

/** RN-210: the IP addresses of the account's own entries are removed. */
export async function clearAuditIpAddresses(db: Db, userId: number): Promise<void> {
  await db.query(`UPDATE "Audit_log" SET ip_address = NULL WHERE actor_user_id = $1 AND ip_address IS NOT NULL`, [userId]);
}
