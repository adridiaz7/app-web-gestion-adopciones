import { Router } from "express";
import { getShelters, postRejectShelter, postRevokeShelter, postValidateShelter } from "../controllers/admin-shelters.js";
import { postRemovePet } from "../controllers/admin-pets.js";
import { getAdminUsers, postReactivateUser, postSuspendUser } from "../controllers/admin-users.js";
import { getIncidents, postCorrectAttendance, postIncidentStatus } from "../controllers/incidents.js";
import { requireRole } from "../middlewares/session.js";

/** Routes of the administrator: every one needs the ADMIN role. */
export function createAdminRouter(): Router {
  const router = Router();
  router.use(requireRole("ADMIN"));

  router.get("/shelters", getShelters);
  router.post("/shelters/:id/validate", postValidateShelter);
  router.post("/shelters/:id/reject", postRejectShelter);
  router.post("/shelters/:id/revoke", postRevokeShelter);

  router.get("/users", getAdminUsers);
  router.post("/users/:id/suspend", postSuspendUser);
  router.post("/users/:id/reactivate", postReactivateUser);

  router.post("/pets/:id/remove", postRemovePet);

  router.get("/incidents", getIncidents);
  router.post("/incidents/:id/status", postIncidentStatus);
  router.post("/visits/:id/correct-attendance", postCorrectAttendance);

  return router;
}
