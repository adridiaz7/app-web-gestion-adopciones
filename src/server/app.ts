import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { z } from "zod";
import type { HealthResponse } from "../shared/api.js";
import { getConfig } from "./config.js";
import { NotFoundError } from "./errors.js";
import { getBreeds, getProvinces } from "./controllers/catalogues.js";
import { getGallery, getPetProfileHandler } from "./controllers/gallery.js";
import { getShelterProfile, getShelters } from "./controllers/shelter-search.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { loadSession } from "./middlewares/session.js";
import { createAdminRouter } from "./routes/admin.js";
import { createAdopterRouter } from "./routes/adopter.js";
import { createAuthRouter } from "./routes/auth.js";
import { createNotificationsRouter } from "./routes/notifications.js";
import { createShelterRouter } from "./routes/shelter.js";

// Default Zod messages in Spanish: they can reach the user (UI texts are in Spanish).
z.config(z.locales.es());

/** Project root: app.ts runs from src/server (dev, tests) or dist/server (build), two levels down. */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** index.html and the CSS are served from the sources; the compiled client code, from dist/client. */
const CLIENT_SOURCE_DIR = join(ROOT, "src", "client");
const CLIENT_BUILD_DIR = join(ROOT, "dist", "client");

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

  api.use(loadSession);
  api.use("/auth", createAuthRouter());
  api.get("/provinces", getProvinces);
  api.get("/breeds", getBreeds);
  api.get("/pets", getGallery);
  api.get("/pets/:id", getPetProfileHandler);
  api.get("/shelters", getShelters);
  api.get("/shelters/:id", getShelterProfile);
  api.use("/admin", createAdminRouter());
  api.use("/adopter", createAdopterRouter());
  api.use("/shelter", createShelterRouter());
  api.use("/notifications", createNotificationsRouter());

  api.use(() => {
    throw new NotFoundError();
  });

  app.use("/api", api);

  // RN-52: uploaded photos are files on disk, served as they are.
  app.use("/uploads", express.static(getConfig().uploadsDir, { index: false }));

  // One origin: the SPA is served next to the API.
  // Under /assets, so a client folder (like src/client/api) never clashes with the /api routes.
  app.use("/assets", express.static(CLIENT_BUILD_DIR, { index: false }));
  app.use("/assets", express.static(CLIENT_SOURCE_DIR, { index: false }));
  // History API router: any page route (no /api, no file extension) gets index.html.
  app.get(/.*/, (req, res, next) => {
    if (extname(req.path) !== "") {
      next();
      return;
    }
    res.sendFile("index.html", { root: CLIENT_SOURCE_DIR });
  });
  app.use(errorHandler);

  return app;
}
