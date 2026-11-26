import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { ShelterProfileResponse } from "../../shared/api.js";
import { BadRequestError, UnauthorizedError } from "../errors.js";
import { editShelterProfile, getShelterOwnProfile, setShelterLogo } from "../services/shelter-profile.js";
import { emailSchema, phoneSchema, provinceIdSchema, requiredText } from "./auth.js";
import { receiveImage } from "./pet-photos.js";

/** An optional text: empty or missing is stored as null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `No puede tener más de ${String(max)} caracteres.` })
    .nullish()
    .transform((text) => (text ? text : null));

/** Empty or missing → null; otherwise it must have the given format. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), schema.nullish().transform((v) => v ?? null));

const WEBSITE = "La web tiene que ser una dirección que empiece por http:// o https://.";

/** CU-06: the public data of the shelter. The name and the CIF are not edited here. */
const profileSchema = z.object({
  description: optionalText(2000),
  address: requiredText(200),
  provinceId: provinceIdSchema,
  locality: requiredText(100),
  phone: phoneSchema,
  contactEmail: optional(emailSchema),
  website: optional(z.string().trim().pipe(z.url({ protocol: /^https?$/, error: WEBSITE }).max(300, { error: "La web es demasiado larga." }))),
  openingHours: optionalText(300),
});

function shelterId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

/** CU-06 · GET /api/shelter/profile */
export const getMyShelterProfile: RequestHandler = async (req, res) => {
  const body: ShelterProfileResponse = { profile: await getShelterOwnProfile(shelterId(req.user)) };
  res.json(body);
};

/** CU-06 · PUT /api/shelter/profile */
export const putMyShelterProfile: RequestHandler = async (req, res) => {
  const input = profileSchema.parse(req.body ?? {});
  const body: ShelterProfileResponse = { profile: await editShelterProfile(shelterId(req.user), input) };
  res.json(body);
};

/** The logo comes in the multipart field "logo". */
export const receiveLogo = receiveImage("logo", "logo");

/** CU-06 · POST /api/shelter/profile/logo (multipart, field "logo") */
export const postLogo: RequestHandler = async (req, res) => {
  if (!req.file) throw new BadRequestError("Elige un logo.");
  const body: ShelterProfileResponse = { profile: await setShelterLogo(shelterId(req.user), req.file.buffer) };
  res.json(body);
};

/** CU-06 · DELETE /api/shelter/profile/logo */
export const deleteLogo: RequestHandler = async (req, res) => {
  const body: ShelterProfileResponse = { profile: await setShelterLogo(shelterId(req.user), null) };
  res.json(body);
};
