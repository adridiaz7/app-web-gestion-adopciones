import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { AdopterProfileResponse } from "../../shared/api.js";
import { UnauthorizedError } from "../errors.js";
import { editAdopterProfile, getAdopterProfile } from "../services/adopter-profile.js";
import { phoneSchema, provinceIdSchema, requiredText } from "./auth.js";

const CHOOSE = "Elige una opción.";
const yesNo = z.boolean({ error: CHOOSE }).nullable();

/** RN-27: in the profile every household field is optional (null = not answered yet). */
const householdSchema = z.object(
  {
    housingType: z.enum(["APARTMENT", "HOUSE", "OTHER"], { error: CHOOSE }).nullable(),
    hasOutdoorSpace: yesNo,
    housingTenure: z.enum(["OWNED", "RENTED", "RENT_TO_OWN"], { error: CHOOSE }).nullable(),
    householdMembers: z.number({ error: "Indica cuántas personas viven en casa." }).int().min(1, { error: "Al menos 1 persona." }).max(50, { error: "Como mucho 50." }).nullable(),
    hasChildren: yesNo,
    hasOtherPets: yesNo,
    otherPetsDescription: z
      .string()
      .trim()
      .max(500, { error: "No puede tener más de 500 caracteres." })
      .nullish()
      .transform((text) => (text ? text : null)),
    hasPetExperience: yesNo,
    hoursAlonePerDay: z.number({ error: "Indica cuántas horas estaría sola." }).int().min(0, { error: "Entre 0 y 24 horas." }).max(24, { error: "Entre 0 y 24 horas." }).nullable(),
  },
  { error: "Indica los datos del hogar." },
);

/** CU-06: the email is not part of it (it changes only through CU-49). */
const profileSchema = z.object({
  firstName: requiredText(100),
  lastName: requiredText(100),
  phone: phoneSchema,
  birthDate: z.iso.date({ error: "La fecha de nacimiento no es válida." }),
  provinceId: provinceIdSchema,
  locality: requiredText(100),
  household: householdSchema,
});

function adopterId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

/** CU-06 · GET /api/adopter/profile */
export const getMyAdopterProfile: RequestHandler = async (req, res) => {
  const body: AdopterProfileResponse = { profile: await getAdopterProfile(adopterId(req.user)) };
  res.json(body);
};

/** CU-06 · PUT /api/adopter/profile */
export const putMyAdopterProfile: RequestHandler = async (req, res) => {
  const input = profileSchema.parse(req.body ?? {});
  const body: AdopterProfileResponse = { profile: await editAdopterProfile(adopterId(req.user), input) };
  res.json(body);
};
