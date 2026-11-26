import { Router } from "express";
import { postIncident } from "../controllers/incidents.js";
import { requireRole } from "../middlewares/session.js";

/** CU-36: adopters and shelters open incidents about each other (RN-165). */
export function createIncidentsRouter(): Router {
  const router = Router();
  router.use(requireRole("ADOPTER", "SHELTER"));
  router.post("/", postIncident);
  return router;
}
