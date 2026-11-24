import type { Db } from "../db/transaction.js";

export type EmailTokenPurpose = "VERIFY_EMAIL" | "RESET_PASSWORD" | "CHANGE_EMAIL";

export interface EmailTokenInsert {
  userId: number;
  purpose: Exclude<EmailTokenPurpose, "CHANGE_EMAIL">;
  /** SHA-256 of the token: the token itself is never stored. */
  tokenHash: string;
  validitySeconds: number;
}

export async function insertEmailToken(db: Db, token: EmailTokenInsert): Promise<void> {
  await db.query(
    `INSERT INTO "Email_token" (user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
    [token.userId, token.purpose, token.tokenHash, token.validitySeconds],
  );
}

export interface FoundEmailToken {
  id: number;
  userId: number;
  /** Not used, not revoked and not expired. */
  usable: boolean;
  userVerified: boolean;
  userDeleted: boolean;
  /** RN-10: the account has a suspension without an end date. */
  userSuspended: boolean;
}

/** Finds a token by its hash and purpose, locking it so it cannot be used twice at once. */
export async function findEmailTokenForUpdate(
  db: Db,
  tokenHash: string,
  purpose: EmailTokenPurpose,
): Promise<FoundEmailToken | null> {
  const { rows } = await db.query<FoundEmailToken>(
    `SELECT t.id, t.user_id AS "userId",
            (t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > now()) AS usable,
            u.email_verified_at IS NOT NULL AS "userVerified",
            u.deleted_at IS NOT NULL AS "userDeleted",
            EXISTS (SELECT 1 FROM "Suspension" s WHERE s.user_id = u.id AND s.ended_at IS NULL) AS "userSuspended"
       FROM "Email_token" t
       JOIN "App_user" u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.purpose = $2
        FOR UPDATE OF t`,
    [tokenHash, purpose],
  );
  return rows[0] ?? null;
}

export async function markEmailTokenUsed(db: Db, id: number): Promise<void> {
  await db.query(`UPDATE "Email_token" SET used_at = now() WHERE id = $1`, [id]);
}

/** RN-180, RN-181: the account's earlier unused links of that purpose stop working. */
export async function revokeUnusedEmailTokens(db: Db, userId: number, purpose: EmailTokenPurpose): Promise<void> {
  await db.query(
    `UPDATE "Email_token" SET revoked_at = now()
      WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL AND revoked_at IS NULL`,
    [userId, purpose],
  );
}

/** RN-180, RN-181: whether the account got a link of that purpose in the last `minutes`. */
export async function emailTokenCreatedWithin(
  db: Db,
  userId: number,
  purpose: EmailTokenPurpose,
  minutes: number,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM "Email_token"
      WHERE user_id = $1 AND purpose = $2 AND created_at > now() - make_interval(mins => $3)
      LIMIT 1`,
    [userId, purpose, minutes],
  );
  return rowCount === 1;
}
