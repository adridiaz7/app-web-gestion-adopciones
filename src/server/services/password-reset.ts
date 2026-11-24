import { getConfig } from "../config.js";
import { withTransaction } from "../db/transaction.js";
import { BadRequestError } from "../errors.js";
import {
  emailTokenCreatedWithin,
  findEmailTokenForUpdate,
  markEmailTokenUsed,
  revokeUnusedEmailTokens,
} from "../models/email-tokens.js";
import { findResettableUserForUpdate, updatePasswordAndVerify } from "../models/users.js";
import { audit } from "./audit.js";
import { createEmailToken, hashToken } from "./email-tokens.js";
import { sendEmail, type Email } from "./email.js";
import { hashPassword } from "./passwords.js";

function resetEmail(to: string, token: string): Email {
  const { appUrl, rules } = getConfig();
  return {
    to,
    subject: "Restablece tu contraseña",
    text: [
      "Hemos recibido una petición para restablecer la contraseña de tu cuenta.",
      "",
      "Para elegir una contraseña nueva, usa este enlace:",
      `${appUrl}/restablecer-contrasena?token=${token}`,
      "",
      `El enlace caduca en ${String(rules.passwordResetValidityMinutes)} minutos y solo se puede usar una vez.`,
      "Si no has sido tú, puedes ignorar este mensaje: tu contraseña no ha cambiado.",
    ].join("\n"),
  };
}

/**
 * CU-05: emails a password reset link (RN-178). The caller always gets the same answer,
 * so it does not reveal which emails have an account. RN-183: unverified accounts get it
 * too; deleted and suspended ones do not. RN-181: at most one link every few minutes per
 * account (configurable), and a new link voids the earlier unused ones.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const { rules } = getConfig();

  const toSend = await withTransaction(async (client) => {
    const user = await findResettableUserForUpdate(client, email);
    if (!user) return null;
    if (await emailTokenCreatedWithin(client, user.id, "RESET_PASSWORD", rules.passwordResetResendWaitMinutes)) {
      return null;
    }
    await revokeUnusedEmailTokens(client, user.id, "RESET_PASSWORD");
    const token = await createEmailToken(client, user.id, "RESET_PASSWORD", rules.passwordResetValidityMinutes * 60);
    return resetEmail(user.email, token);
  });

  if (toSend) await sendEmail(toSend);
}

const INVALID_LINK = "El enlace no es válido o ha caducado. Puedes pedir uno nuevo.";

/**
 * CU-05: sets a new password with a reset link. RN-178: the link works once. RN-183: it
 * also verifies the email. RN-208: the reset is recorded in the audit log.
 */
export async function resetPassword(token: string, password: string, ip: string | undefined): Promise<void> {
  const passwordHash = await hashPassword(password);

  await withTransaction(async (client) => {
    const found = await findEmailTokenForUpdate(client, hashToken(token), "RESET_PASSWORD");
    if (!found?.usable || found.userDeleted || found.userSuspended) throw new BadRequestError(INVALID_LINK);

    await markEmailTokenUsed(client, found.id);
    await updatePasswordAndVerify(client, found.userId, passwordHash);
    await audit(client, {
      actorUserId: found.userId,
      action: "PASSWORD_RESET",
      entityType: "App_user",
      entityId: found.userId,
      ...(ip === undefined ? {} : { ipAddress: ip }),
    });
  });
}
