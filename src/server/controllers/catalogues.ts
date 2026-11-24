import type { RequestHandler } from "express";
import type { ProvincesResponse } from "../../shared/api.js";
import { listProvinces } from "../services/catalogues.js";

/** GET /api/provinces: public, because the sign-up forms need it. */
export const getProvinces: RequestHandler = async (_req, res) => {
  const body: ProvincesResponse = { provinces: await listProvinces() };
  res.json(body);
};
