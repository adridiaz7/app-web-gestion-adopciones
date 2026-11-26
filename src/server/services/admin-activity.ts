import { getPool } from "../db/pool.js";
import { selectAuditEntries, selectPlatformStats, type AuditEntryRow, type AuditFilters, type PlatformStats } from "../models/admin-activity.js";

export type { AuditEntryRow, AuditFilters, PlatformStats };

/** CU-43, RN-161: any visit, adoption or block with its history, or what an account did (RN-208). */
export async function listAuditEntries(filters: AuditFilters): Promise<AuditEntryRow[]> {
  return selectAuditEntries(getPool(), filters);
}

/** CU-44, RN-160 */
export async function getPlatformStats(): Promise<PlatformStats> {
  return selectPlatformStats(getPool());
}
