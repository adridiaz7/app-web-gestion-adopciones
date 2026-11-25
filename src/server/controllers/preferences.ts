import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { PreferencesResponse } from "../../shared/api.js";
import { UnauthorizedError } from "../errors.js";
import { getPreferences, updatePreferences } from "../services/preferences.js";

const INVALID = "La respuesta no es válida.";

/** A list of distinct answers; an empty or missing list means "me da igual" (RN-33, RN-34). */
const distinct = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item, { error: INVALID })
    .max(max, { error: INVALID })
    .refine((list) => new Set(list).size === list.length, { error: "No repitas respuestas." })
    .default([]);

const id = (max: number) => z.number({ error: INVALID }).int({ error: INVALID }).positive({ error: INVALID }).max(max, { error: INVALID });
const months = z.number({ error: INVALID }).int({ error: INVALID }).min(0, { error: INVALID }).max(600, { error: INVALID }).nullable().default(null);

/** RN-32: the questions of the questionnaire, all optional (RN-34). */
const preferencesSchema = z.object({
  speciesIds: distinct(id(32767), 20),
  breedIds: distinct(id(2_147_483_647), 300),
  sizes: distinct(z.enum(["SMALL", "MEDIUM", "LARGE"], { error: INVALID }), 3),
  sexes: distinct(z.enum(["MALE", "FEMALE"], { error: INVALID }), 2),
  activityLevels: distinct(z.enum(["LOW", "MEDIUM", "HIGH"], { error: INVALID }), 3),
  minAgeMonths: months,
  maxAgeMonths: months,
  needsGoodWithChildren: z.boolean({ error: INVALID }).default(false),
  mustGetAlongWithSpeciesIds: distinct(id(32767), 20),
});

function adopterId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

/** CU-08 · GET /api/adopter/preferences */
export const getMyPreferences: RequestHandler = async (req, res) => {
  const body: PreferencesResponse = { preferences: await getPreferences(adopterId(req.user)) };
  res.json(body);
};

/** CU-08 · PUT /api/adopter/preferences */
export const putMyPreferences: RequestHandler = async (req, res) => {
  const prefs = preferencesSchema.parse(req.body ?? {});
  const body: PreferencesResponse = { preferences: await updatePreferences(adopterId(req.user), prefs) };
  res.json(body);
};
