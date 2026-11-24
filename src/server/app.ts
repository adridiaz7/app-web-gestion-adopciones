import express from "express";
import type { HealthResponse } from "../shared/api.js";
import { NotFoundError } from "./errors.js";
import { errorHandler } from "./middlewares/error-handler.js";

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

  api.use(() => {
    throw new NotFoundError();
  });

  app.use("/api", api);
  app.use(errorHandler);

  return app;
}
