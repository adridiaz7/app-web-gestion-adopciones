import type { Db } from "../db/transaction.js";

export type Role = "ADOPTER" | "SHELTER" | "ADMIN";

export interface UserInsert {
  email: string;
  passwordHash: string;
  role: Role;
}

/**
 * Inserts an unverified account with the terms accepted now (RN-186). Returns null when
 * the email is already taken (RN-06: unique index on lower(email)), without failing, so
 * concurrent sign-ups with the same email behave like any other existing email.
 */
export async function insertUserIfEmailFree(db: Db, user: UserInsert): Promise<{ id: number } | null> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO "App_user" (email, password_hash, role, terms_accepted_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT ((lower(email))) DO NOTHING
     RETURNING id`,
    [user.email, user.passwordHash, user.role],
  );
  return rows[0] ?? null;
}

/**
 * RN-182: marks that the owner of `email` gets an "existing account" notice now, if the
 * account is not deleted, has no active suspension and got no notice in the last
 * `waitMinutes`. Returns the account email to write to, or null when no notice is due.
 * A single UPDATE, so two concurrent attempts cannot both send a notice.
 */
export async function claimExistingAccountNotice(
  db: Db,
  email: string,
  waitMinutes: number,
): Promise<{ email: string } | null> {
  const { rows } = await db.query<{ email: string }>(
    `UPDATE "App_user" u
        SET existing_account_notice_at = now()
      WHERE lower(u.email) = lower($1)
        AND u.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM "Suspension" s WHERE s.user_id = u.id AND s.ended_at IS NULL)
        AND (u.existing_account_notice_at IS NULL
             OR u.existing_account_notice_at <= now() - make_interval(mins => $2))
      RETURNING u.email`,
    [email, waitMinutes],
  );
  return rows[0] ?? null;
}

export async function markEmailVerified(db: Db, userId: number): Promise<void> {
  await db.query(`UPDATE "App_user" SET email_verified_at = now(), updated_at = now() WHERE id = $1`, [userId]);
}

/**
 * The account with this email if it is still unverified and not deleted, locked so two
 * requests for the same account are handled one after the other (RN-180).
 */
export async function findUnverifiedUserForUpdate(db: Db, email: string): Promise<{ id: number; email: string } | null> {
  const { rows } = await db.query<{ id: number; email: string }>(
    `SELECT id, email FROM "App_user"
      WHERE lower(email) = lower($1) AND email_verified_at IS NULL AND deleted_at IS NULL
        FOR UPDATE`,
    [email],
  );
  return rows[0] ?? null;
}

export interface LoginCandidate {
  id: number;
  email: string;
  role: Role;
  passwordHash: string;
  verified: boolean;
  /** RN-10: has a suspension without an end date. */
  suspended: boolean;
}

/** The account that can try to log in with this email: not deleted (RN-11). */
export async function findLoginCandidate(db: Db, email: string): Promise<LoginCandidate | null> {
  const { rows } = await db.query<LoginCandidate>(
    `SELECT u.id, u.email, u.role, u.password_hash AS "passwordHash",
            u.email_verified_at IS NOT NULL AS verified,
            EXISTS (SELECT 1 FROM "Suspension" s WHERE s.user_id = u.id AND s.ended_at IS NULL) AS suspended
       FROM "App_user" u
      WHERE lower(u.email) = lower($1) AND u.deleted_at IS NULL`,
    [email],
  );
  return rows[0] ?? null;
}

/**
 * RN-183: the account with this email that can get a password reset link (verified or
 * not, but neither deleted nor suspended), locked so two requests for it are handled
 * one after the other (RN-181).
 */
export async function findResettableUserForUpdate(db: Db, email: string): Promise<{ id: number; email: string } | null> {
  const { rows } = await db.query<{ id: number; email: string }>(
    `SELECT u.id, u.email FROM "App_user" u
      WHERE lower(u.email) = lower($1) AND u.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM "Suspension" s WHERE s.user_id = u.id AND s.ended_at IS NULL)
        FOR UPDATE OF u`,
    [email],
  );
  return rows[0] ?? null;
}

/** Sets a new password. RN-183: it also verifies the email, if it was not verified yet. */
export async function updatePasswordAndVerify(db: Db, userId: number, passwordHash: string): Promise<void> {
  await db.query(
    `UPDATE "App_user"
        SET password_hash = $2, email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
      WHERE id = $1`,
    [userId, passwordHash],
  );
}
