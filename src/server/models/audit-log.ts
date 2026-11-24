import type { Db } from "../db/transaction.js";

export interface AuditLogInsert {
  actorUserId: number | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
}

/** RN-209: the audit log only gets inserts; there is deliberately no update or delete here. */
export async function insertAuditLog(db: Db, entry: AuditLogInsert): Promise<void> {
  await db.query(
    `INSERT INTO "Audit_log" (actor_user_id, action, entity_type, entity_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entry.actorUserId, entry.action, entry.entityType, entry.entityId, JSON.stringify(entry.details), entry.ipAddress],
  );
}
