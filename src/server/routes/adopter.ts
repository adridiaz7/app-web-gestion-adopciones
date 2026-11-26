import { Router } from "express";
import { getDiscover, postDiscard, postFavorite, postUndo } from "../controllers/discover.js";
import { deleteDiscard, deleteFavorite, getDiscards, getFavorites, putFavorite } from "../controllers/favorites.js";
import { getAdopterAdoptions, getAdoptionEligibilityOf, getMyHousehold, postAdopterCancelAdoption, postAdoption } from "../controllers/adoptions.js";
import { getMyAdopterProfile, putMyAdopterProfile } from "../controllers/adopter-profile.js";
import { getMyPreferences, putMyPreferences } from "../controllers/preferences.js";
import {
  getAdopterVisits,
  getAvailableSlots,
  getReplacementSlots,
  postAdopterCancelVisit,
  postReplaceVisit,
  postRescheduleVisit,
  postVisit,
} from "../controllers/visits.js";
import { requireRole } from "../middlewares/session.js";

/** Routes of the adopter's own area: every one needs the ADOPTER role. */
export function createAdopterRouter(): Router {
  const router = Router();
  router.use(requireRole("ADOPTER"));

  router.get("/profile", getMyAdopterProfile);
  router.put("/profile", putMyAdopterProfile);

  router.get("/preferences", getMyPreferences);
  router.put("/preferences", putMyPreferences);

  router.get("/discover", getDiscover);
  router.post("/discover/pets/:id/favorite", postFavorite);
  router.post("/discover/pets/:id/discard", postDiscard);
  router.post("/discover/undo", postUndo);

  router.get("/favorites", getFavorites);
  router.put("/favorites/:petId", putFavorite);
  router.delete("/favorites/:petId", deleteFavorite);
  router.get("/discards", getDiscards);
  router.delete("/discards/:petId", deleteDiscard);

  router.get("/pets/:id/slots", getAvailableSlots);
  router.get("/visits", getAdopterVisits);
  router.post("/visits", postVisit);
  router.post("/visits/:id/cancel", postAdopterCancelVisit);
  router.post("/visits/:id/reschedule", postRescheduleVisit);
  router.get("/visits/:id/replacement-slots", getReplacementSlots);
  router.post("/visits/:id/replace", postReplaceVisit);

  router.get("/household", getMyHousehold);
  router.get("/pets/:id/adoption-eligibility", getAdoptionEligibilityOf);
  router.get("/adoptions", getAdopterAdoptions);
  router.post("/adoptions", postAdoption);
  router.post("/adoptions/:id/cancel", postAdopterCancelAdoption);

  return router;
}
