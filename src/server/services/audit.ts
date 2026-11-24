import type { Db } from "../db/transaction.js";
import { insertAuditLog } from "../models/audit-log.js";

export interface AuditEntry {
  /** Who did it. null = the system (scheduled jobs) or an unidentified user (failed login). */
  actorUserId: number | null;
  /** Upper-case action code: SHELTER_VALIDATED, PET_UPDATED, LOGIN_FAILED… */
  action: string;
  /** Affected table ("Pet", "Visit"…) and row, if any. */
  entityType?: string;
  entityId?: number;
  /** What changed ({ before, after }) or data about the event. */
  details?: Record<string, unknown>;
  /** Only for security events. */
  ipAddress?: string;
}

/** RN-209: keys whose values are never stored (passwords, hashes, tokens). */
const SECRET_KEY = /password|hash|token/i;

function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (typeof value === "object" && value !== null && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SECRET_KEY.test(key))
        .map(([key, nested]) => [key, withoutSecrets(nested)]),
    );
  }
  return value;
}

/**
 * RN-208: writes an entry in the audit log. Pass the transaction client of the action,
 * so the entry exists only if the action is committed.
 */
export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  await insertAuditLog(db, {
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    details: withoutSecrets(entry.details ?? {}) as Record<string, unknown>,
    ipAddress: entry.ipAddress ?? null,
  });
}
