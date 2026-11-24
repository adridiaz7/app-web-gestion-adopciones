import type { RequestHandler } from "express";
import { z } from "zod";
import type { MessageResponse, SessionResponse } from "../../shared/api.js";
import { UnauthorizedError } from "../errors.js";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "../middlewares/session.js";
import { resendVerification, verifyEmail } from "../services/email-verification.js";
import { requestPasswordReset, resetPassword } from "../services/password-reset.js";
import { registerAdopter, registerShelter } from "../services/registration.js";
import { logIn, logOut } from "../services/sessions.js";

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

const verifyEmailSchema = z.object({
  token: z.string({ error: "Falta el enlace de verificación." }).min(1, { error: "Falta el enlace de verificación." }),
});

/** CU-03 · POST /api/auth/verify-email */
export const postVerifyEmail: RequestHandler = async (req, res) => {
  const { token } = verifyEmailSchema.parse(req.body ?? {});
  await verifyEmail(token);
  const body: MessageResponse = { message: "Tu email está verificado. Ya puedes iniciar sesión." };
  res.json(body);
};

const resendVerificationSchema = z.object({ email: emailSchema });

/** Same answer whether the email has an unverified account or not. */
const RESENT: MessageResponse = {
  message: "Si ese email tiene una cuenta pendiente de verificar, te hemos enviado un enlace nuevo. Revisa tu correo.",
};

/** CU-03 · POST /api/auth/resend-verification */
export const postResendVerification: RequestHandler = async (req, res) => {
  const { email } = resendVerificationSchema.parse(req.body ?? {});
  await resendVerification(email);
  res.status(202).json(RESENT);
};

const loginSchema = z.object({
  email: z.string({ error: REQUIRED }).trim().min(1, { error: REQUIRED }),
  // The RN-175 maximum also keeps huge inputs away from the password hash.
  password: z.string({ error: REQUIRED }).min(1, { error: REQUIRED }).max(256, { error: "La contraseña no es válida." }),
});

/** CU-04 · POST /api/auth/login */
export const postLogin: RequestHandler = async (req, res) => {
  const { email, password } = loginSchema.parse(req.body ?? {});
  const { token, user } = await logIn(email, password, req.ip);
  setSessionCookie(res, token);
  const body: SessionResponse = { user };
  res.json(body);
};

/** CU-04 · POST /api/auth/logout. Without a session there is nothing to close, and that is not an error. */
export const postLogout: RequestHandler = async (req, res) => {
  const token = readSessionToken(req);
  if (token) await logOut(token);
  clearSessionCookie(res);
  res.status(204).end();
};

/** GET /api/auth/me: the logged-in user, so the client knows who it is and what to show. */
export const getMe: RequestHandler = (req, res) => {
  if (!req.user) throw new UnauthorizedError();
  const body: SessionResponse = { user: req.user };
  res.json(body);
};

const forgotPasswordSchema = z.object({ email: emailSchema });

/** Same answer whether the email has an account or not. */
const RESET_SENT: MessageResponse = {
  message: "Si ese email tiene una cuenta, te hemos enviado un enlace para restablecer la contraseña. Revisa tu correo.",
};

/** CU-05 · POST /api/auth/forgot-password */
export const postForgotPassword: RequestHandler = async (req, res) => {
  const { email } = forgotPasswordSchema.parse(req.body ?? {});
  await requestPasswordReset(email);
  res.status(202).json(RESET_SENT);
};

const MISSING_RESET_TOKEN = "Falta el enlace para restablecer la contraseña.";
const resetPasswordSchema = z.object({
  token: z.string({ error: MISSING_RESET_TOKEN }).min(1, { error: MISSING_RESET_TOKEN }),
  password: passwordSchema,
});

/** CU-05 · POST /api/auth/reset-password */
export const postResetPassword: RequestHandler = async (req, res) => {
  const { token, password } = resetPasswordSchema.parse(req.body ?? {});
  await resetPassword(token, password, req.ip);
  const body: MessageResponse = { message: "Tu contraseña se ha cambiado. Ya puedes iniciar sesión." };
  res.json(body);
};
