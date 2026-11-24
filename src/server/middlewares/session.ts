import type { CookieOptions, Request, RequestHandler, Response } from "express";
import { getConfig } from "../config.js";
import { ForbiddenError, UnauthorizedError } from "../errors.js";
import type { Role } from "../models/users.js";
import { resumeSession, type SessionUser } from "../services/sessions.js";

declare module "express-serve-static-core" {
  interface Request {
    /** The logged-in user, set by loadSession. */
    user?: SessionUser;
  }
}

export const SESSION_COOKIE = "lagun_session";

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: getConfig().nodeEnv === "production",
    path: "/",
  };
}

/** Sends the session cookie, lasting as long as the session (RN-176). */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: getConfig().rules.sessionDurationDays * 86_400_000 });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/** The session token sent in the Cookie header, if any. No cookie-parser: only one cookie is read. */
export function readSessionToken(req: Request): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join("=")) || undefined;
  }
  return undefined;
}

/**
 * Sets req.user when the request carries a valid session. RN-176: a session about to
 * expire is renewed, and the cookie is sent again with the new lifetime.
 */
export const loadSession: RequestHandler = async (req, res, next) => {
  const token = readSessionToken(req);
  if (token) {
    const session = await resumeSession(token);
    if (session) {
      req.user = session.user;
      if (session.renewed) setSessionCookie(res, token);
    }
  }
  next();
};

/** Only for logged-in users. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new UnauthorizedError();
  next();
};

/** Only for logged-in users with one of these roles. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw new UnauthorizedError();
    if (!roles.includes(req.user.role)) throw new ForbiddenError();
    next();
  };
}
