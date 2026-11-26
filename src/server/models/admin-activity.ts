import type { Db } from "../db/transaction.js";

export interface AuditFilters {
  entityType?: string | undefined;
  entityId?: number | undefined;
  actorId?: number | undefined;
}

export interface AuditEntryRow {
  id: number;
  action: string;
  entityType: string | null;
  entityId: number | null;
  details: unknown;
  createdAt: Date;
  actor: { id: number; email: string; role: string } | null;
}

/**
 * CU-43, RN-161: audit entries, at most 200. The history of one item reads oldest first; any
 * other search, newest first.
 */
export async function selectAuditEntries(db: Db, filters: AuditFilters): Promise<AuditEntryRow[]> {
  const oneItem = filters.entityType !== undefined && filters.entityId !== undefined;
  const { rows } = await db.query<AuditEntryRow>(
    `SELECT l.id, l.action, l.entity_type AS "entityType", l.entity_id AS "entityId", l.details, l.created_at AS "createdAt",
            CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('id', u.id, 'email', u.email, 'role', u.role) END AS actor
       FROM "Audit_log" l
       LEFT JOIN "App_user" u ON u.id = l.actor_user_id
      WHERE ($1::text IS NULL OR l.entity_type = $1)
        AND ($2::bigint IS NULL OR l.entity_id = $2)
        AND ($3::bigint IS NULL OR l.actor_user_id = $3)
      ORDER BY l.id ${oneItem ? "ASC" : "DESC"}
      LIMIT 200`,
    [filters.entityType ?? null, filters.entityId ?? null, filters.actorId ?? null],
  );
  return rows;
}

export interface PlatformStats {
  adoptions: { pending: number; approved: number; completed: number; returned: number; rejected: number; cancelled: number };
  averageDaysToDecide: number | null;
  averageDaysToDeliver: number | null;
  visits: { completed: number; noShow: number };
  blocks: { active: number; total: number };
  incidents: { open: number; total: number };
}

/** CU-44, RN-160: global indicators, in one query. Averages in days with one decimal. */
export async function selectPlatformStats(db: Db): Promise<PlatformStats> {
  const { rows } = await db.query<PlatformStats>(
    `SELECT json_build_object(
              'pending',   count(*) FILTER (WHERE status = 'PENDING'),
              'approved',  count(*) FILTER (WHERE status = 'APPROVED'),
              'completed', count(*) FILTER (WHERE status = 'COMPLETED'),
              'returned',  count(*) FILTER (WHERE status = 'RETURNED'),
              'rejected',  count(*) FILTER (WHERE status = 'REJECTED'),
              'cancelled', count(*) FILTER (WHERE status = 'CANCELLED')) AS adoptions,
            round((avg(extract(epoch FROM decided_at - created_at)) FILTER (WHERE decided_at IS NOT NULL) / 86400)::numeric, 1)::float8
              AS "averageDaysToDecide",
            round((avg(extract(epoch FROM delivered_at - decided_at)) FILTER (WHERE delivered_at IS NOT NULL) / 86400)::numeric, 1)::float8
              AS "averageDaysToDeliver",
            (SELECT json_build_object('completed', count(*) FILTER (WHERE status = 'COMPLETED'),
                                      'noShow',    count(*) FILTER (WHERE status = 'NO_SHOW')) FROM "Visit") AS visits,
            (SELECT json_build_object('active', count(*) FILTER (WHERE lifted_at IS NULL AND (ends_at IS NULL OR ends_at > now())),
                                      'total',  count(*)) FROM "Block") AS blocks,
            (SELECT json_build_object('open',  count(*) FILTER (WHERE status IN ('OPEN', 'IN_REVIEW')),
                                      'total', count(*)) FROM "Incident") AS incidents
       FROM "Adoption"`,
  );
  const row = rows[0];
  if (!row) throw new Error("selectPlatformStats: no row returned");
  return row;
}
