import type { RequestHandler } from "express";
import { z } from "zod";
import type { ShelterPageResponse, SheltersResponse } from "../../shared/api.js";
import { UnauthorizedError } from "../errors.js";
import { getShelterPage, searchShelters } from "../services/shelter-search.js";

const INVALID = "El filtro no es válido.";
const INVALID_SHELTER = "La protectora no es válida.";

/** RN-69: optional name (part of it) and province. */
const filtersSchema = z.object({
  name: z
    .string({ error: INVALID })
    .trim()
    .max(100, { error: "El nombre no puede tener más de 100 caracteres." })
    .optional()
    .transform((name) => name || undefined),
  provinceId: z.coerce.number({ error: INVALID }).int({ error: INVALID }).positive({ error: INVALID }).max(32767, { error: INVALID }).optional(),
});

const idParamsSchema = z.object({
  id: z.coerce
    .number({ error: INVALID_SHELTER })
    .int({ error: INVALID_SHELTER })
    .positive({ error: INVALID_SHELTER })
    .max(Number.MAX_SAFE_INTEGER, { error: INVALID_SHELTER }),
});

/** CU-13 · GET /api/shelters: only with a session (RN-187). */
export const getShelters: RequestHandler = async (req, res) => {
  if (!req.user) throw new UnauthorizedError();
  const filters = filtersSchema.parse(req.query);
  const body: SheltersResponse = { shelters: await searchShelters(req.user, filters) };
  res.json(body);
};

/** CU-13 · GET /api/shelters/:id: only with a session (RN-187). */
export const getShelterProfile: RequestHandler = async (req, res) => {
  if (!req.user) throw new UnauthorizedError();
  const { id } = idParamsSchema.parse(req.params);
  const page = await getShelterPage(req.user, id);
  const body: ShelterPageResponse = {
    shelter: page.shelter,
    block: page.block ? { endsAt: page.block.endsAt?.toISOString() ?? null } : null,
    pets: page.pets,
  };
  res.json(body);
};
