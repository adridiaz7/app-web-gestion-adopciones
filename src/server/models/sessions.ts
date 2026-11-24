import type { Db } from "../db/transaction.js";
import type { Role } from "./users.js";

export async function insertSession(db: Db, tokenHash: string, userId: number, durationDays: number): Promise<void> {
  await db.query(
    `INSERT INTO "Session" (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
    [tokenHash, userId, durationDays],
  );
}

export interface SessionUser {
  id: number;
  email: string;
  role: Role;
}

/**
 * RN-176: the user of a session that has not expired, renewing it for `durationDays` when
 * less than `renewalMarginDays` remain. A single statement, so concurrent requests are safe.
 * Sessions of deleted accounts are not valid (RN-11).
 */
export async function useSession(
  db: Db,
  tokenHash: string,
  durationDays: number,
  renewalMarginDays: number,
): Promise<{ user: SessionUser; renewed: boolean } | null> {
  const { rows } = await db.query<SessionUser & { renewed: boolean }>(
    `WITH found AS (
       SELECT s.token_hash, u.id, u.email, u.role,
              s.expires_at < now() + make_interval(days => $3) AS renew
         FROM "Session" s
         JOIN "App_user" u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND u.deleted_at IS NULL
     ), renewed AS (
       UPDATE "Session" s SET expires_at = now() + make_interval(days => $2)
         FROM found f
        WHERE s.token_hash = f.token_hash AND f.renew
     )
     SELECT id, email, role, renew AS renewed FROM found`,
    [tokenHash, durationDays, renewalMarginDays],
  );
  const row = rows[0];
  if (!row) return null;
  return { user: { id: row.id, email: row.email, role: row.role }, renewed: row.renewed };
}

export async function deleteSession(db: Db, tokenHash: string): Promise<void> {
  await db.query(`DELETE FROM "Session" WHERE token_hash = $1`, [tokenHash]);
}

export async function deleteUserSessions(db: Db, userId: number): Promise<void> {
  await db.query(`DELETE FROM "Session" WHERE user_id = $1`, [userId]);
}
