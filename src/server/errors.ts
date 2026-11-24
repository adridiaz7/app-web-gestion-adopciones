/**
 * Errors that services throw on purpose. The error middleware turns them into an HTTP
 * response with their status and their message, which is user-facing text in Spanish.
 * Anything else becomes a generic 500.
 */
export class AppError extends Error {
  override name = "AppError";

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "La petición no es válida.") {
    super(400, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Tienes que iniciar sesión.") {
    super(401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "No tienes permiso para realizar esta acción.") {
    super(403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Recurso no encontrado.") {
    super(404, message);
  }
}

/** The action breaks a business rule given the current state (full slot, quota reached…). */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message);
  }
}
