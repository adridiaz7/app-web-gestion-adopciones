import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { AdminShelterResponse, AdminSheltersResponse } from "../../shared/api.js";
import { UnauthorizedError } from "../errors.js";
import {
  listShelters,
  rejectShelter,
  revokeShelterValidation,
  validateShelter,
  type ShelterForAdmin,
} from "../services/shelter-validation.js";

const listQuerySchema = z.object({
  status: z.enum(["PENDING", "VALIDATED", "REJECTED"], { error: "El estado no es válido." }).default("PENDING"),
});

const idParamsSchema = z.object({
  id: z.coerce.number({ error: "La protectora no es válida." }).int().positive().max(Number.MAX_SAFE_INTEGER),
});

const REASON = "Indica el motivo.";
const reasonBodySchema = z.object({
  reason: z.string({ error: REASON }).trim().min(1, { error: REASON }).max(1000, { error: "El motivo es demasiado largo." }),
});

function toResponse(shelter: ShelterForAdmin): AdminShelterResponse["shelter"] {
  return {
    ...shelter,
    registeredAt: shelter.registeredAt.toISOString(),
    validatedAt: shelter.validatedAt?.toISOString() ?? null,
  };
}

function adminId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

/** CU-39 · GET /api/admin/shelters?status=PENDING|VALIDATED|REJECTED */
export const getShelters: RequestHandler = async (req, res) => {
  const { status } = listQuerySchema.parse(req.query);
  const body: AdminSheltersResponse = { shelters: (await listShelters(status)).map(toResponse) };
  res.json(body);
};

/** CU-39 · POST /api/admin/shelters/:id/validate */
export const postValidateShelter: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const body: AdminShelterResponse = { shelter: toResponse(await validateShelter(adminId(req.user), id)) };
  res.json(body);
};

/** CU-39 · POST /api/admin/shelters/:id/reject */
export const postRejectShelter: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const { reason } = reasonBodySchema.parse(req.body ?? {});
  const body: AdminShelterResponse = { shelter: toResponse(await rejectShelter(adminId(req.user), id, reason)) };
  res.json(body);
};

/** CU-39 · POST /api/admin/shelters/:id/revoke */
export const postRevokeShelter: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const { reason } = reasonBodySchema.parse(req.body ?? {});
  const body: AdminShelterResponse = { shelter: toResponse(await revokeShelterValidation(adminId(req.user), id, reason)) };
  res.json(body);
};
