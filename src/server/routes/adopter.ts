import { Router } from "express";
import { getDiscover, postDiscard, postFavorite, postUndo } from "../controllers/discover.js";
import { getMyPreferences, putMyPreferences } from "../controllers/preferences.js";
import { requireRole } from "../middlewares/session.js";

/** Routes of the adopter's own area: every one needs the ADOPTER role. */
export function createAdopterRouter(): Router {
  const router = Router();
  router.use(requireRole("ADOPTER"));

  router.get("/preferences", getMyPreferences);
  router.put("/preferences", putMyPreferences);

  router.get("/discover", getDiscover);
  router.post("/discover/pets/:id/favorite", postFavorite);
  router.post("/discover/pets/:id/discard", postDiscard);
  router.post("/discover/undo", postUndo);

  return router;
}
