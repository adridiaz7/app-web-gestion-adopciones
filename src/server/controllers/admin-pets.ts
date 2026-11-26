import type { RequestHandler } from "express";
import { z } from "zod";
import { UnauthorizedError } from "../errors.js";
import { removePetByAdmin } from "../services/pet-unlisting.js";

const INVALID = "La mascota no es válida.";
const petParamsSchema = z.object({
  id: z.coerce.number({ error: INVALID }).int({ error: INVALID }).positive({ error: INVALID }).max(Number.MAX_SAFE_INTEGER, { error: INVALID }),
});

/** CU-41 · POST /api/admin/pets/:id/remove */
export const postRemovePet: RequestHandler = async (req, res) => {
  if (!req.user) throw new UnauthorizedError();
  const { id } = petParamsSchema.parse(req.params);
  await removePetByAdmin(req.user.id, id);
  res.status(204).end();
};
