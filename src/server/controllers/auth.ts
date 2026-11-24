import type { RequestHandler } from "express";
import { z } from "zod";
import type { MessageResponse } from "../../shared/api.js";
import { registerAdopter, registerShelter } from "../services/registration.js";

const REQUIRED = "Este campo es obligatorio.";

const requiredText = (max: number) =>
  z
    .string({ error: REQUIRED })
    .trim()
    .min(1, { error: REQUIRED })
    .max(max, { error: `No puede tener más de ${String(max)} caracteres.` });

export const emailSchema = z
  .string({ error: REQUIRED })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "El email no tiene un formato válido." }).max(254, { error: "El email es demasiado largo." }));

/** RN-175: 12 to 256 characters, with no composition rules. */
export const passwordSchema = z
  .string({ error: REQUIRED })
  .min(12, { error: "La contraseña debe tener al menos 12 caracteres." })
  .max(256, { error: "La contraseña no puede tener más de 256 caracteres." });

/** Spanish phone number: 9 digits starting with 6, 7, 8 or 9, optionally with +34. Spaces are ignored. */
export const phoneSchema = z
  .string({ error: REQUIRED })
  .transform((phone) => phone.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^(\+34)?[6-9]\d{8}$/, { error: "El teléfono no tiene un formato válido." }));

const PROVINCE = "Elige una provincia.";
// "Province".id is a smallint: a larger value would reach PostgreSQL and fail as a 500.
const provinceIdSchema = z
  .number({ error: PROVINCE })
  .int({ error: PROVINCE })
  .positive({ error: PROVINCE })
  .max(32767, { error: PROVINCE });

/**
 * Spanish CIF: an organisation-type letter, 7 digits and a control character.
 * Spaces and hyphens are ignored and it is stored upper-cased, so RN-17 compares like with like.
 */
export const cifSchema = z
  .string({ error: REQUIRED })
  .transform((cif) => cif.replace(/[\s-]/g, "").toUpperCase())
  .pipe(
    z
      .string()
      .min(1, { error: REQUIRED })
      .regex(/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/, { error: "El CIF no tiene un formato válido." }),
  );

const adopterRegistrationSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: requiredText(100),
  lastName: requiredText(100),
  phone: phoneSchema,
  birthDate: z.iso.date({ error: "La fecha de nacimiento no es válida." }),
  provinceId: provinceIdSchema,
  locality: requiredText(100),
  acceptTerms: z.boolean({ error: REQUIRED }),
});

const shelterRegistrationSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: requiredText(150),
  cif: cifSchema,
  address: requiredText(200),
  provinceId: provinceIdSchema,
  locality: requiredText(100),
  phone: phoneSchema,
  acceptTerms: z.boolean({ error: REQUIRED }),
});

/** Same answer whether the email was new or already had an account (RN-182). */
const REGISTERED: MessageResponse = { message: "Te hemos enviado un email con un enlace para verificar tu cuenta." };

/** CU-01 · POST /api/auth/register/adopter */
export const postRegisterAdopter: RequestHandler = async (req, res) => {
  // Express 5 leaves req.body undefined when there is no JSON body: validate it field by field.
  const input = adopterRegistrationSchema.parse(req.body ?? {});
  await registerAdopter(input);
  res.status(202).json(REGISTERED);
};

/** CU-02 · POST /api/auth/register/shelter */
export const postRegisterShelter: RequestHandler = async (req, res) => {
  const input = shelterRegistrationSchema.parse(req.body ?? {});
  await registerShelter(input);
  res.status(202).json(REGISTERED);
};
