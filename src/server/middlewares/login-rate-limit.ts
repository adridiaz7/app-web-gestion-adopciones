import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import type { ErrorResponse } from "../../shared/api.js";
import { getConfig } from "../config.js";

/**
 * RN-179: at most N login attempts per IP in each window (both configurable). Built per
 * app, so every app instance (and every test) has its own counter.
 */
export function loginRateLimit(): RequestHandler {
  const { loginMaxAttempts, loginAttemptsWindowMinutes } = getConfig().rules;
  const body: ErrorResponse = {
    error: "Has hecho demasiados intentos de inicio de sesión. Vuelve a intentarlo dentro de unos minutos.",
  };
  return rateLimit({
    windowMs: loginAttemptsWindowMinutes * 60_000,
    limit: loginMaxAttempts,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json(body);
    },
  });
}
