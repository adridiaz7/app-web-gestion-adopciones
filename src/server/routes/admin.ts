import { Router } from "express";
import { getShelters, postRejectShelter, postRevokeShelter, postValidateShelter } from "../controllers/admin-shelters.js";
import { requireRole } from "../middlewares/session.js";

/** Routes of the administrator: every one needs the ADMIN role. */
export function createAdminRouter(): Router {
  const router = Router();
  router.use(requireRole("ADMIN"));

  router.get("/shelters", getShelters);
  router.post("/shelters/:id/validate", postValidateShelter);
  router.post("/shelters/:id/reject", postRejectShelter);
  router.post("/shelters/:id/revoke", postRevokeShelter);

  return router;
}
