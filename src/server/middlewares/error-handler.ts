import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { ErrorResponse } from "../../shared/api.js";
import { AppError } from "../errors.js";

const GENERIC_MESSAGE = "Ha ocurrido un error inesperado. Inténtalo de nuevo más tarde.";

/** Error raised by express.json() when the body is not valid JSON. */
function isJsonParseError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "type" in error && error.type === "entity.parse.failed";
}

/**
 * Last middleware of the app. Known errors keep their status and message; everything
 * else (database errors included) is logged on the server and answered with a generic
 * 500, so internal details never reach the client.
 */
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  let status = 500;
  let body: ErrorResponse = { error: GENERIC_MESSAGE };

  if (error instanceof AppError) {
    status = error.status;
    body = { error: error.message };
  } else if (error instanceof ZodError) {
    status = 400;
    const fields: Record<string, string> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message;
    }
    body = { error: "Los datos enviados no son válidos.", fields };
  } else if (isJsonParseError(error)) {
    status = 400;
    body = { error: "El cuerpo de la petición no es un JSON válido." };
  } else {
    console.error(error);
  }

  res.status(status).json(body);
};
