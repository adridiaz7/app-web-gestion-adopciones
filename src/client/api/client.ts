import type { ErrorResponse } from "../../shared/api.js";

const GENERIC_ERROR = "Ha ocurrido un error inesperado. Inténtalo de nuevo más tarde.";
const NETWORK_ERROR = "No se ha podido conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.";

/** An API error, with the message for the user (in Spanish) and the invalid fields, if any. */
export class ApiError extends Error {
  override name = "ApiError";

  constructor(
    /** HTTP status, or 0 when the server could not be reached. */
    readonly status: number,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string";
}

/**
 * Calls the API on the same origin, so the session cookie goes with it. Resolves to the
 * JSON answer (undefined when there is none) or throws an ApiError.
 */
export async function apiRequest<T = unknown>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, NETWORK_ERROR);
  }

  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }

  if (!response.ok) {
    if (isErrorResponse(data)) throw new ApiError(response.status, data.error, data.fields ?? {});
    throw new ApiError(response.status, GENERIC_ERROR);
  }
  return data as T;
}
