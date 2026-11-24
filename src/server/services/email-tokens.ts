import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/transaction.js";
import { insertEmailToken, type EmailTokenInsert } from "../models/email-tokens.js";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Creates a single-use email link token and returns it in clear, to put in the link.
 * Only its SHA-256 hash is stored, so a database leak does not expose valid links.
 */
export async function createEmailToken(
  db: Db,
  userId: number,
  purpose: EmailTokenInsert["purpose"],
  validitySeconds: number,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await insertEmailToken(db, { userId, purpose, tokenHash: hashToken(token), validitySeconds });
  return token;
}
