import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { DiscoverResponse } from "../../shared/api.js";
import { UnauthorizedError } from "../errors.js";
import { discardPet, favoritePet, getDiscoverState, undoLastDiscard } from "../services/discover.js";

const INVALID_PET = "La mascota no es válida.";
const petId = (number: z.ZodNumber) =>
  number.int({ error: INVALID_PET }).positive({ error: INVALID_PET }).max(Number.MAX_SAFE_INTEGER, { error: INVALID_PET });

const paramsSchema = z.object({ id: petId(z.coerce.number({ error: INVALID_PET })) });
const undoSchema = z.object({ petId: petId(z.number({ error: INVALID_PET })) });

function adopterId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

/** CU-10 · GET /api/adopter/discover */
export const getDiscover: RequestHandler = async (req, res) => {
  const body: DiscoverResponse = await getDiscoverState(adopterId(req.user));
  res.json(body);
};

/** CU-10 · POST /api/adopter/discover/pets/:id/favorite */
export const postFavorite: RequestHandler = async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  const body: DiscoverResponse = await favoritePet(adopterId(req.user), id);
  res.json(body);
};

/** CU-10 · POST /api/adopter/discover/pets/:id/discard */
export const postDiscard: RequestHandler = async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  const body: DiscoverResponse = await discardPet(adopterId(req.user), id);
  res.json(body);
};

/** CU-10 · POST /api/adopter/discover/undo { petId } */
export const postUndo: RequestHandler = async (req, res) => {
  const { petId: id } = undoSchema.parse(req.body ?? {});
  const body: DiscoverResponse = await undoLastDiscard(adopterId(req.user), id);
  res.json(body);
};
