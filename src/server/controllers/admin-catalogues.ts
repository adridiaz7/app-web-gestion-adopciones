import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { BreedResponse, SpeciesResponse } from "../../shared/api.js";
import { UnauthorizedError } from "../errors.js";
import { createBreed, createSpecies, renameBreed, renameSpecies } from "../services/catalogues.js";

const NAME = "Escribe el nombre.";
const nameSchema = z.string({ error: NAME }).trim().min(1, { error: NAME }).max(100, { error: "No puede tener más de 100 caracteres." });
const INVALID = "El identificador no es válido.";
const idSchema = z.object({
  id: z.coerce.number({ error: INVALID }).int({ error: INVALID }).positive({ error: INVALID }).max(2_147_483_647, { error: INVALID }),
});
const SPECIES = "Elige la especie de la raza.";
const speciesBody = z.object({ name: nameSchema });
const newBreedBody = z.object({
  speciesId: z.number({ error: SPECIES }).int({ error: SPECIES }).positive({ error: SPECIES }).max(32767, { error: SPECIES }),
  name: nameSchema,
});
const breedBody = z.object({ name: nameSchema });

function adminId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

/** CU-42 · POST /api/admin/species */
export const postSpecies: RequestHandler = async (req, res) => {
  const { name } = speciesBody.parse(req.body ?? {});
  const body: SpeciesResponse = { species: await createSpecies(adminId(req.user), name) };
  res.status(201).json(body);
};

/** CU-42 · PUT /api/admin/species/:id */
export const putSpecies: RequestHandler = async (req, res) => {
  const { id } = idSchema.parse(req.params);
  const { name } = speciesBody.parse(req.body ?? {});
  const body: SpeciesResponse = { species: await renameSpecies(adminId(req.user), id, name) };
  res.json(body);
};

/** CU-42 · POST /api/admin/breeds */
export const postBreed: RequestHandler = async (req, res) => {
  const { speciesId, name } = newBreedBody.parse(req.body ?? {});
  const body: BreedResponse = { breed: await createBreed(adminId(req.user), speciesId, name) };
  res.status(201).json(body);
};

/** CU-42 · PUT /api/admin/breeds/:id */
export const putBreed: RequestHandler = async (req, res) => {
  const { id } = idSchema.parse(req.params);
  const { name } = breedBody.parse(req.body ?? {});
  const body: BreedResponse = { breed: await renameBreed(adminId(req.user), id, name) };
  res.json(body);
};
