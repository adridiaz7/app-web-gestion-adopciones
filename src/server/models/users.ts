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
