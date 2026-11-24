import { randomBytes } from "node:crypto";
import { getConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { ForbiddenError, UnauthorizedError } from "../errors.js";
import { deleteSession, insertSession, useSession, type SessionUser } from "../models/sessions.js";
import { findLoginCandidate } from "../models/users.js";
import { audit } from "./audit.js";
import { hashToken } from "./email-tokens.js";
import { hashPassword, verifyPassword } from "./passwords.js";

export type { SessionUser };

const WRONG_CREDENTIALS = "El email o la contraseña no son correctos.";

/** Hash checked when the email has no account, so the response time does not reveal it. */
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

/** RN-208: failed logins are security events. Neither the email tried nor the password is stored (RN-209). */
async function recordFailedLogin(userId: number | null, reason: string, ip: string | undefined): Promise<void> {
  await audit(getPool(), {
    actorUserId: null,
    action: "LOGIN_FAILED",
    ...(userId === null ? {} : { entityType: "App_user", entityId: userId }),
    details: { reason },
    ...(ip === undefined ? {} : { ipAddress: ip }),
  });
}

/**
 * CU-04: checks the email and password and opens a session (RN-176). Returns the token
 * in clear for the cookie; only its hash is stored. The account state is only revealed
 * to whoever knows the password.
 */
export async function logIn(
  email: string,
  password: string,
  ip: string | undefined,
): Promise<{ token: string; user: SessionUser }> {
  const candidate = await findLoginCandidate(getPool(), email);
  if (!candidate) {
    await verifyPassword(await getDummyHash(), password);
    await recordFailedLogin(null, "UNKNOWN_EMAIL", ip);
    throw new UnauthorizedError(WRONG_CREDENTIALS);
  }
  if (!(await verifyPassword(candidate.passwordHash, password))) {
    await recordFailedLogin(candidate.id, "WRONG_PASSWORD", ip);
    throw new UnauthorizedError(WRONG_CREDENTIALS);
  }
  // RN-07: the account is not active until the email is verified.
  if (!candidate.verified) {
    await recordFailedLogin(candidate.id, "EMAIL_NOT_VERIFIED", ip);
    throw new ForbiddenError(
      "Tienes que verificar tu email antes de iniciar sesión. Revisa tu correo o pide un enlace nuevo.",
    );
  }
  // RN-10: no login while a suspension is active.
  if (candidate.suspended) {
    await recordFailedLogin(candidate.id, "SUSPENDED", ip);
    throw new ForbiddenError("Tu cuenta está suspendida. No puedes iniciar sesión mientras dure la suspensión.");
  }

  const token = randomBytes(32).toString("base64url");
  await insertSession(getPool(), hashToken(token), candidate.id, getConfig().rules.sessionDurationDays);
  return { token, user: { id: candidate.id, email: candidate.email, role: candidate.role } };
}

/** RN-176: the user of a valid session, and whether it was renewed (so the cookie is sent again). */
export async function resumeSession(token: string): Promise<{ user: SessionUser; renewed: boolean } | null> {
  const { sessionDurationDays, sessionRenewalMarginDays } = getConfig().rules;
  return useSession(getPool(), hashToken(token), sessionDurationDays, sessionRenewalMarginDays);
}

/** CU-04: logging out deletes the session, so it stops working at once. */
export async function logOut(token: string): Promise<void> {
  await deleteSession(getPool(), hashToken(token));
}
