import { Router } from "express";
import { getMyPreferences, putMyPreferences } from "../controllers/preferences.js";
import { requireRole } from "../middlewares/session.js";

/** Routes of the adopter's own area: every one needs the ADOPTER role. */
export function createAdopterRouter(): Router {
  const router = Router();
  router.use(requireRole("ADOPTER"));

  router.get("/preferences", getMyPreferences);
  router.put("/preferences", putMyPreferences);

  return router;
}
