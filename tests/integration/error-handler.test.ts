import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { z } from "zod";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../src/server/errors.js";
import { errorHandler } from "../../src/server/middlewares/error-handler.js";

/** A tiny app with routes that fail in each possible way, behind the real error handler. */
function appThatFails(): express.Express {
  const app = express();
  app.use(express.json());
  app.get("/not-found", () => {
    throw new NotFoundError("La mascota no existe.");
  });
  app.get("/forbidden", () => {
    throw new ForbiddenError();
  });
  app.get("/conflict", async () => {
    await Promise.resolve();
    throw new ConflictError("El turno ya está completo.");
  });
  app.post("/zod", (req) => {
    z.object({ name: z.string().min(1), age: z.number().int() }).parse(req.body);
  });
  app.get("/db", async () => {
    await getPool().query(`SELECT secret_column FROM "Missing_table"`);
  });
  app.get("/unexpected", () => {
    throw new Error("internal detail that must not leak");
  });
  app.use(errorHandler);
  return app;
}

describe("T-03 error handler", () => {
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("answers an application error with its status and its Spanish message", async () => {
    const notFound = await request(appThatFails()).get("/not-found");
    expect(notFound.status).toBe(404);
    expect(notFound.body).toEqual({ error: "La mascota no existe." });

    const conflict = await request(appThatFails()).get("/conflict");
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual({ error: "El turno ya está completo." });
  });

  it("uses a default Spanish message when the error does not give one", async () => {
    const res = await request(appThatFails()).get("/forbidden");

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "No tienes permiso para realizar esta acción." });
  });

  it("answers an invalid input format (Zod) with 400 and the invalid fields", async () => {
    const res = await request(appThatFails()).post("/zod").send({ name: "", age: "tres" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Los datos enviados no son válidos.");
    expect(Object.keys(res.body.fields as object).sort()).toEqual(["age", "name"]);
  });

  it("answers a malformed JSON body with 400 in the real app", async () => {
    const res = await request(createApp())
      .post("/api/health")
      .set("Content-Type", "application/json")
      .send("{not json");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "El cuerpo de la petición no es un JSON válido." });
  });

  it("never sends a database error to the client: 500 with a generic message, logged on the server", async () => {
    const res = await request(appThatFails()).get("/db");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Ha ocurrido un error inesperado. Inténtalo de nuevo más tarde." });
    expect(JSON.stringify(res.body)).not.toMatch(/Missing_table|secret_column|42P01/);
    expect(consoleError).toHaveBeenCalled();
  });

  it("answers any unexpected error with 500 and a generic message", async () => {
    const res = await request(appThatFails()).get("/unexpected");

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("internal detail");
  });
});
