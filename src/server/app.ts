import express from "express";
import type { ErrorResponse, HealthResponse } from "../shared/api.js";

/** Builds the Express app. It does not listen: server.ts does, and the tests use supertest. */
export function createApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  const api = express.Router();

  api.get("/health", (_req, res) => {
    const body: HealthResponse = { status: "ok" };
    res.json(body);
  });

  api.use((_req, res) => {
    const body: ErrorResponse = { error: "Recurso no encontrado." };
    res.status(404).json(body);
  });

  app.use("/api", api);

  return app;
}
