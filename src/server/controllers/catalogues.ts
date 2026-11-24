import type { RequestHandler } from "express";
import type { BreedsResponse, ProvincesResponse } from "../../shared/api.js";
import { listProvinces, listSpeciesWithBreeds } from "../services/catalogues.js";

/** GET /api/provinces: public, because the sign-up forms need it. */
export const getProvinces: RequestHandler = async (_req, res) => {
  const body: ProvincesResponse = { provinces: await listProvinces() };
  res.json(body);
};

/** GET /api/breeds: public, because the gallery filters need it too. */
export const getBreeds: RequestHandler = async (_req, res) => {
  const body: BreedsResponse = { species: await listSpeciesWithBreeds() };
  res.json(body);
};
