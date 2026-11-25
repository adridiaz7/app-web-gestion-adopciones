import type { RequestHandler } from "express";
import { z } from "zod";
import type { GalleryResponse } from "../../shared/api.js";
import { listGalleryPets } from "../services/gallery.js";

const INVALID = "El filtro no es válido.";

const optionalId = (max: number) => z.coerce.number({ error: INVALID }).int({ error: INVALID }).positive({ error: INVALID }).max(max, { error: INVALID }).optional();
const optionalMonths = z.coerce.number({ error: INVALID }).int({ error: INVALID }).min(0, { error: INVALID }).max(600, { error: INVALID }).optional();

/** RN-189, RN-205: the gallery filters, all optional. Ages are in months. */
const filtersSchema = z
  .object({
    speciesId: optionalId(32767),
    breedId: optionalId(2_147_483_647),
    size: z.enum(["SMALL", "MEDIUM", "LARGE"], { error: INVALID }).optional(),
    sex: z.enum(["MALE", "FEMALE"], { error: INVALID }).optional(),
    provinceId: optionalId(32767),
    minAgeMonths: optionalMonths,
    maxAgeMonths: optionalMonths,
  })
  .refine((f) => f.minAgeMonths === undefined || f.maxAgeMonths === undefined || f.minAgeMonths <= f.maxAgeMonths, {
    error: "La edad mínima no puede ser mayor que la máxima.",
    path: ["maxAgeMonths"],
  });

/** CU-09 · GET /api/pets: public (RN-187); with a session, the adopter's blocks apply (RN-77). */
export const getGallery: RequestHandler = async (req, res) => {
  const filters = filtersSchema.parse(req.query);
  const body: GalleryResponse = { pets: await listGalleryPets(req.user, filters) };
  res.json(body);
};
