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
