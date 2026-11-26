import type { RequestHandler } from "express";
import { z } from "zod";
import type { ShelterAdopterResponse } from "../../shared/api.js";
import { UnauthorizedError } from "../errors.js";
import { getAdopterProfileForShelter } from "../services/shelter-adopters.js";

const INVALID_ADOPTER = "El adoptante no es válido.";
const paramsSchema = z.object({
  id: z.coerce
    .number({ error: INVALID_ADOPTER })
    .int({ error: INVALID_ADOPTER })
    .positive({ error: INVALID_ADOPTER })
    .max(Number.MAX_SAFE_INTEGER, { error: INVALID_ADOPTER }),
});

/** CU-22, RN-29 · GET /api/shelter/adopters/:id */
export const getShelterAdopter: RequestHandler = async (req, res) => {
  if (!req.user) throw new UnauthorizedError();
  const { id } = paramsSchema.parse(req.params);
  const adopter = await getAdopterProfileForShelter(req.user.id, id);
  const body: ShelterAdopterResponse = {
    adopter: {
      ...adopter,
      visits: adopter.visits.map((visit) => ({ ...visit, startsAt: visit.startsAt.toISOString(), endsAt: visit.endsAt.toISOString() })),
    },
  };
  res.json(body);
};
