import type { Db } from "../db/transaction.js";

/** RN-155: the reasons of a suspension. */
export type SuspensionReason = "INAPPROPRIATE_BEHAVIOUR" | "FALSE_INFORMATION" | "INAPPROPRIATE_CONTENT" | "FRAUD" | "REPEATED_INCIDENTS" | "OTHER";

export interface Suspension {
  id: number;
  userId: number;
  reason: SuspensionReason;
  detail: string | null;
  startedAt: Date;
}

const SUSPENSION_COLUMNS = `id, user_id AS "userId", reason, detail, started_at AS "startedAt"`;

/** CU-40: an adopter or shelter account that is not deleted, locked; null otherwise. */
export async function lockSuspendableUser(db: Db, userId: number): Promise<{ role: "ADOPTER" | "SHELTER" } | null> {
  const { rows } = await db.query<{ role: "ADOPTER" | "SHELTER" }>(
    `SELECT role FROM "App_user" WHERE id = $1 AND role IN ('ADOPTER', 'SHELTER') AND deleted_at IS NULL FOR UPDATE`,
    [userId],
  );
  return rows[0] ?? null;
}

/** RN-156: at most one active suspension; null when there is one already (partial unique index). */
export async function insertSuspensionIfNoneActive(db: Db, userId: number, reason: SuspensionReason, detail: string | null): Promise<Suspension | null> {
  const { rows } = await db.query<Suspension>(
    `INSERT INTO "Suspension" (user_id, reason, detail) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) WHERE ended_at IS NULL DO NOTHING
     RETURNING ${SUSPENSION_COLUMNS}`,
    [userId, reason, detail],
  );
  return rows[0] ?? null;
}

/** RN-156: ends the active suspension; it stays in the history. Returns its id, or null if there was none. */
export async function endActiveSuspension(db: Db, userId: number): Promise<number | null> {
  const { rows } = await db.query<{ id: number }>(`UPDATE "Suspension" SET ended_at = now() WHERE user_id = $1 AND ended_at IS NULL RETURNING id`, [userId]);
  return rows[0]?.id ?? null;
}

/** RN-158: the adopter's APPROVED adoptions, at any shelter, are cancelled by the system. */
export async function cancelAdopterApprovedAdoptions(db: Db, adopterId: number): Promise<{ id: number; petId: number; petName: string }[]> {
  const { rows } = await db.query<{ id: number; petId: number; petName: string }>(
    `UPDATE "Adoption" a SET status = 'CANCELLED', cancelled_by = 'SYSTEM', cancelled_at = now()
       FROM "Pet" p
      WHERE p.id = a.pet_id AND a.adopter_id = $1 AND a.status = 'APPROVED'
     RETURNING a.id, a.pet_id AS "petId", p.name AS "petName"`,
    [adopterId],
  );
  return rows.sort((a, b) => a.id - b.id);
}

/** CU-40: an account the administrator can suspend or reactivate. */
export interface AdminUserRow {
  id: number;
  role: "ADOPTER" | "SHELTER";
  email: string;
  name: string;
  suspension: { reason: SuspensionReason; detail: string | null; startedAt: Date } | null;
}

/** CU-40: adopters and shelters that are not deleted, filtered by name or email, at most 100. */
export async function selectAdminUsers(db: Db, query: string): Promise<AdminUserRow[]> {
  const { rows } = await db.query<AdminUserRow>(
    `SELECT u.id, u.role, u.email,
            COALESCE(s.name, a.first_name || ' ' || a.last_name) AS name,
            CASE WHEN sp.id IS NULL THEN NULL
                 ELSE json_build_object('reason', sp.reason, 'detail', sp.detail, 'startedAt', sp.started_at) END AS suspension
       FROM "App_user" u
       LEFT JOIN "Adopter" a ON a.user_id = u.id
       LEFT JOIN "Shelter" s ON s.user_id = u.id
       LEFT JOIN "Suspension" sp ON sp.user_id = u.id AND sp.ended_at IS NULL
      WHERE u.role IN ('ADOPTER', 'SHELTER') AND u.deleted_at IS NULL
        AND ($1 = '' OR u.email ILIKE '%' || $1 || '%' OR COALESCE(s.name, a.first_name || ' ' || a.last_name) ILIKE '%' || $1 || '%')
      ORDER BY name, u.id
      LIMIT 100`,
    [query],
  );
  return rows.map((row) => ({ ...row, suspension: row.suspension ? { ...row.suspension, startedAt: new Date(row.suspension.startedAt) } : null }));
}
