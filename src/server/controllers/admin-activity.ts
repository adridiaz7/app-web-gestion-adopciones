import type { RequestHandler } from "express";
import { z } from "zod";
import type { AuditLogResponse, StatsResponse } from "../../shared/api.js";
import { getPlatformStats, listAuditEntries } from "../services/admin-activity.js";

const INVALID = "El filtro no es válido.";
const id = z.coerce.number({ error: INVALID }).int({ error: INVALID }).positive({ error: INVALID }).max(Number.MAX_SAFE_INTEGER, { error: INVALID }).optional();
const auditQuerySchema = z.object({
  entityType: z.string().regex(/^[A-Z][A-Za-z_]{1,40}$/, { error: INVALID }).optional(),
  entityId: id,
  actorId: id,
});

/** CU-43 · GET /api/admin/audit-log?entityType=&entityId=&actorId= */
export const getAuditLog: RequestHandler = async (req, res) => {
  const filters = auditQuerySchema.parse(req.query);
  const entries = await listAuditEntries(filters);
  const body: AuditLogResponse = { entries: entries.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })) };
  res.json(body);
};

/** CU-44 · GET /api/admin/stats */
export const getStats: RequestHandler = async (_req, res) => {
  const body: StatsResponse = { stats: await getPlatformStats() };
  res.json(body);
};
