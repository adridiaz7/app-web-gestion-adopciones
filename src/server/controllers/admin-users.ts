import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { AdminUsersResponse, SuspensionResponse } from "../../shared/api.js";
import { UnauthorizedError } from "../errors.js";
import { listAdminUsers, reactivateUser, suspendUser } from "../services/suspensions.js";

const INVALID = "La cuenta no es válida.";
const userParamsSchema = z.object({
  id: z.coerce.number({ error: INVALID }).int({ error: INVALID }).positive({ error: INVALID }).max(Number.MAX_SAFE_INTEGER, { error: INVALID }),
});

/** RN-155: a reason from the list and an optional detail. */
const REASON = "Elige el motivo de la suspensión.";
const suspendSchema = z.object({
  reason: z.enum(["INAPPROPRIATE_BEHAVIOUR", "FALSE_INFORMATION", "INAPPROPRIATE_CONTENT", "FRAUD", "REPEATED_INCIDENTS", "OTHER"], { error: REASON }),
  detail: z
    .string()
    .trim()
    .max(1000, { error: "El detalle no puede tener más de 1000 caracteres." })
    .nullish()
    .transform((text) => (text ? text : null)),
});

const listSchema = z.object({ q: z.string().trim().max(100).optional().default("") });

function adminId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

/** CU-40 · GET /api/admin/users?q= */
export const getAdminUsers: RequestHandler = async (req, res) => {
  const { q } = listSchema.parse(req.query);
  const users = await listAdminUsers(q);
  const body: AdminUsersResponse = {
    users: users.map((u) => ({ ...u, suspension: u.suspension ? { ...u.suspension, startedAt: u.suspension.startedAt.toISOString() } : null })),
  };
  res.json(body);
};

/** CU-40 · POST /api/admin/users/:id/suspend */
export const postSuspendUser: RequestHandler = async (req, res) => {
  const { id } = userParamsSchema.parse(req.params);
  const { reason, detail } = suspendSchema.parse(req.body ?? {});
  const suspension = await suspendUser(adminId(req.user), id, reason, detail);
  const body: SuspensionResponse = { suspension: { ...suspension, startedAt: suspension.startedAt.toISOString() } };
  res.status(201).json(body);
};

/** CU-40 · POST /api/admin/users/:id/reactivate */
export const postReactivateUser: RequestHandler = async (req, res) => {
  const { id } = userParamsSchema.parse(req.params);
  await reactivateUser(adminId(req.user), id);
  res.status(204).end();
};
