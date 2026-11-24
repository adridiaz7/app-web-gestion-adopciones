import { createHash, randomBytes } from "node:crypto";
import { getPool } from "../../src/server/db/pool.js";

/**
 * Opens a session for the user straight in the database and returns the Cookie header
 * to send with supertest. Faster than logging in, which hashes the password.
 */
export async function sessionCookie(userId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await getPool().query(
    `INSERT INTO "Session" (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '30 days')`,
    [createHash("sha256").update(token).digest("hex"), userId],
  );
  return `lagun_session=${token}`;
}
