import { getConfig } from "../config.js";
import { withTransaction, type Db } from "../db/transaction.js";
import { BadRequestError, ConflictError } from "../errors.js";
import {
  emailTokenCreatedWithin,
  findEmailTokenForUpdate,
  markEmailTokenUsed,
  revokeUnusedEmailTokens,
} from "../models/email-tokens.js";
import { findUnverifiedUserForUpdate, markEmailVerified } from "../models/users.js";
import { createEmailToken, hashToken } from "./email-tokens.js";
import { sendEmail, type Email } from "./email.js";

function verificationEmail(to: string, token: string): Email {
  const { appUrl, rules } = getConfig();
  return {
    to,
    subject: "Verifica tu email",
    text: [
      "¡Gracias por registrarte!",
      "",
      "Para activar tu cuenta, verifica tu email con este enlace:",
      `${appUrl}/verificar-email?token=${token}`,
      "",
      `El enlace caduca en ${String(rules.emailVerificationValidityHours)} horas.`,
    ].join("\n"),
  };
}

/**
 * RN-177, RN-180: creates a verification link for the account, valid for the configured
 * hours, and voids its earlier unused ones. Returns the email to send after the commit.
 */
export async function createVerificationEmail(db: Db, userId: number, email: string): Promise<Email> {
  await revokeUnusedEmailTokens(db, userId, "VERIFY_EMAIL");
  const validitySeconds = getConfig().rules.emailVerificationValidityHours * 3600;
  const token = await createEmailToken(db, userId, "VERIFY_EMAIL", validitySeconds);
  return verificationEmail(email, token);
}

const INVALID_LINK = "El enlace no es válido o ha caducado. Puedes pedir uno nuevo.";

/** CU-03: verifies the email of the account the link belongs to (RN-07). */
export async function verifyEmail(token: string): Promise<void> {
  await withTransaction(async (client) => {
    const found = await findEmailTokenForUpdate(client, hashToken(token), "VERIFY_EMAIL");
    if (!found || found.userDeleted) throw new BadRequestError(INVALID_LINK);
    // Checked before the link state: opening the link again after using it is not an error of the link.
    if (found.userVerified) throw new ConflictError("Tu email ya estaba verificado. Puedes iniciar sesión.");
    if (!found.usable) throw new BadRequestError(INVALID_LINK);

    await markEmailTokenUsed(client, found.id);
    await markEmailVerified(client, found.userId);
  });
}

/**
 * CU-03: sends a new verification link to an unverified account. The caller always gets
 * the same answer, so it does not reveal which emails have an account. RN-180: at most
 * one link every few minutes per account (configurable).
 */
export async function resendVerification(email: string): Promise<void> {
  const { rules } = getConfig();

  const toSend = await withTransaction(async (client) => {
    const user = await findUnverifiedUserForUpdate(client, email);
    if (!user) return null;
    if (await emailTokenCreatedWithin(client, user.id, "VERIFY_EMAIL", rules.verificationResendWaitMinutes)) {
      return null;
    }
    return createVerificationEmail(client, user.id, user.email);
  });

  if (toSend) await sendEmail(toSend);
}
