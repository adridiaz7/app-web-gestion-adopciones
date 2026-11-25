import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { DiscardsResponse, FavoritesResponse } from "../../shared/api.js";
import { UnauthorizedError } from "../errors.js";
import { addFavorite, listDiscards, listFavorites, recoverDiscard, removeFavorite } from "../services/favorites.js";

const INVALID_PET = "La mascota no es válida.";
const paramsSchema = z.object({
  petId: z.coerce
    .number({ error: INVALID_PET })
    .int({ error: INVALID_PET })
    .positive({ error: INVALID_PET })
    .max(Number.MAX_SAFE_INTEGER, { error: INVALID_PET }),
});

function adopterId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

/** CU-12 · GET /api/adopter/favorites */
export const getFavorites: RequestHandler = async (req, res) => {
  const body: FavoritesResponse = { favorites: await listFavorites(adopterId(req.user)) };
  res.json(body);
};

/** CU-12, RN-73 · PUT /api/adopter/favorites/:petId */
export const putFavorite: RequestHandler = async (req, res) => {
  const { petId } = paramsSchema.parse(req.params);
  await addFavorite(adopterId(req.user), petId);
  res.json({});
};

/** CU-12, RN-76 · DELETE /api/adopter/favorites/:petId */
export const deleteFavorite: RequestHandler = async (req, res) => {
  const { petId } = paramsSchema.parse(req.params);
  await removeFavorite(adopterId(req.user), petId);
  res.status(204).end();
};

/** CU-12 · GET /api/adopter/discards */
export const getDiscards: RequestHandler = async (req, res) => {
  const body: DiscardsResponse = { discards: await listDiscards(adopterId(req.user)) };
  res.json(body);
};

/** CU-12, RN-76 · DELETE /api/adopter/discards/:petId */
export const deleteDiscard: RequestHandler = async (req, res) => {
  const { petId } = paramsSchema.parse(req.params);
  await recoverDiscard(adopterId(req.user), petId);
  res.status(204).end();
};
