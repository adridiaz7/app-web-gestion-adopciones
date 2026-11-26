import type { Db } from "../db/transaction.js";

/** The login data of an account (not deleted), locked so two changes are handled one after the other. */
export async function lockCredentials(db: Db, userId: number): Promise<{ email: string; passwordHash: string } | null> {
  const { rows } = await db.query<{ email: string; passwordHash: string }>(
    `SELECT email, password_hash AS "passwordHash" FROM "App_user" WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function updatePassword(db: Db, userId: number, passwordHash: string): Promise<void> {
  await db.query(`UPDATE "App_user" SET password_hash = $2, updated_at = now() WHERE id = $1`, [userId, passwordHash]);
}

/** Whether any account (deleted ones included) already uses the email, ignoring case. */
export async function emailInUse(db: Db, email: string): Promise<boolean> {
  const { rowCount } = await db.query(`SELECT 1 FROM "App_user" WHERE lower(email) = lower($1)`, [email]);
  return rowCount === 1;
}

export async function updateEmail(db: Db, userId: number, email: string): Promise<void> {
  await db.query(`UPDATE "App_user" SET email = $2, updated_at = now() WHERE id = $1`, [userId, email]);
}

/** CU-49: a single-use link to confirm `newEmail`. Only the token's SHA-256 is stored. */
export async function insertChangeEmailToken(db: Db, userId: number, tokenHash: string, newEmail: string, validitySeconds: number): Promise<void> {
  await db.query(
    `INSERT INTO "Email_token" (user_id, purpose, token_hash, new_email, expires_at)
     VALUES ($1, 'CHANGE_EMAIL', $2, $3, now() + make_interval(secs => $4))`,
    [userId, tokenHash, newEmail, validitySeconds],
  );
}

export interface ChangeEmailToken {
  id: number;
  userId: number;
  newEmail: string;
  oldEmail: string;
}

/**
 * CU-49: a usable change-of-email link (not used, revoked or expired, of an account that is
 * neither deleted nor suspended), locked so it cannot be used twice at once.
 */
export async function findUsableChangeEmailToken(db: Db, tokenHash: string): Promise<ChangeEmailToken | null> {
  const { rows } = await db.query<ChangeEmailToken>(
    `SELECT t.id, t.user_id AS "userId", t.new_email AS "newEmail", u.email AS "oldEmail"
       FROM "Email_token" t
       JOIN "App_user" u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.purpose = 'CHANGE_EMAIL'
        AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > now()
        AND u.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM "Suspension" s WHERE s.user_id = u.id AND s.ended_at IS NULL)
        FOR UPDATE OF t, u`,
    [tokenHash],
  );
  return rows[0] ?? null;
}
