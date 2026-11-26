import { randomBytes } from "node:crypto";
import { getConfig } from "../config.js";
import { withTransaction } from "../db/transaction.js";
import { BadRequestError, UnauthorizedError } from "../errors.js";
import {
  emailInUse,
  findUsableChangeEmailToken,
  insertChangeEmailToken,
  lockCredentials,
  updateEmail,
  updatePassword,
} from "../models/account-credentials.js";
import { markEmailTokenUsed, revokeUnusedEmailTokens } from "../models/email-tokens.js";
import { audit } from "./audit.js";
import { hashToken } from "./email-tokens.js";
import { sendEmail, type Email } from "./email.js";
import { hashPassword, verifyPassword } from "./passwords.js";

/**
 * CU-49: changes the password, given the current one. The new one is validated by the
 * controller (RN-175) and stored as an Argon2id hash (RN-08). Audited (RN-208).
 */
export async function changePassword(userId: number, currentPassword: string, newPassword: string, ip: string | undefined): Promise<void> {
  const newHash = await hashPassword(newPassword);
  await withTransaction(async (client) => {
    const account = await lockCredentials(client, userId);
    if (!account) throw new UnauthorizedError();
    if (!(await verifyPassword(account.passwordHash, currentPassword))) throw new BadRequestError("La contraseña actual no es correcta.");
    await updatePassword(client, userId, newHash);
    await audit(client, { actorUserId: userId, action: "PASSWORD_CHANGED", entityType: "App_user", entityId: userId, ...(ip === undefined ? {} : { ipAddress: ip }) });
  });
}

function confirmEmailChange(to: string, token: string): Email {
  const { appUrl, rules } = getConfig();
  return {
    to,
    subject: "Confirma tu email nuevo",
    text: [
      "Has pedido usar este email para entrar en tu cuenta.",
      "",
      "Para confirmarlo, usa este enlace:",
      `${appUrl}/confirmar-email?token=${token}`,
      "",
      `El enlace caduca en ${String(rules.emailVerificationValidityHours)} horas.`,
      "Si no has sido tú, puedes ignorar este mensaje.",
    ].join("\n"),
  };
}

/**
 * CU-49: sends a link to the new email; the email changes only when it is opened. It is
 * valid as long as an email verification link (RN-177), and a new request voids the earlier
 * unused link. An email already registered gets the same answer and no link, so the answer
 * does not reveal which emails have an account (as in RN-182).
 */
export async function requestEmailChange(userId: number, newEmail: string): Promise<void> {
  const toSend = await withTransaction(async (client) => {
    if (!(await lockCredentials(client, userId))) throw new UnauthorizedError();
    if (await emailInUse(client, newEmail)) return null;
    await revokeUnusedEmailTokens(client, userId, "CHANGE_EMAIL");
    const token = randomBytes(32).toString("base64url");
    await insertChangeEmailToken(client, userId, hashToken(token), newEmail, getConfig().rules.emailVerificationValidityHours * 3600);
    return confirmEmailChange(newEmail, token);
  });
  if (toSend) await sendEmail(toSend);
}

const INVALID_LINK = "El enlace no es válido o ha caducado. Puedes pedir uno nuevo.";

function emailChangedNotice(to: string, newEmail: string): Email {
  return {
    to,
    subject: "Tu email ha cambiado",
    text: [
      `El email para entrar en tu cuenta ha cambiado a ${newEmail}.`,
      "",
      "Si no has sido tú, ponte en contacto con nosotros cuanto antes.",
    ].join("\n"),
  };
}

/**
 * CU-49: opening the link changes the email (the link works once) and the old address is told.
 * If the new email was registered in the meantime, the link is no longer valid. Audited
 * (RN-208) without the addresses, so RN-210 has nothing to anonymise here. Returns the new email.
 */
export async function confirmEmailChangeLink(token: string): Promise<string> {
  const { newEmail, notice } = await withTransaction(async (client) => {
    const found = await findUsableChangeEmailToken(client, hashToken(token));
    if (!found || (await emailInUse(client, found.newEmail))) throw new BadRequestError(INVALID_LINK);
    await markEmailTokenUsed(client, found.id);
    await updateEmail(client, found.userId, found.newEmail);
    await audit(client, { actorUserId: found.userId, action: "EMAIL_CHANGED", entityType: "App_user", entityId: found.userId });
    return { newEmail: found.newEmail, notice: emailChangedNotice(found.oldEmail, found.newEmail) };
  });
  await sendEmail(notice);
  return newEmail;
}
