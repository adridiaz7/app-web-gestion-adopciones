import { Router } from "express";
import { getPet, getPets, postPet, putPet } from "../controllers/shelter-pets.js";
import { requireRole } from "../middlewares/session.js";

/** Routes of the shelter's own area: every one needs the SHELTER role. */
export function createShelterRouter(): Router {
  const router = Router();
  router.use(requireRole("SHELTER"));

  router.get("/pets", getPets);
  router.post("/pets", postPet);
  router.get("/pets/:id", getPet);
  router.put("/pets/:id", putPet);

  return router;
}
