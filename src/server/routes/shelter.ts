import { Router } from "express";
import { deletePhoto, getPhotos, postPhoto, putPhotoOrder, receivePhoto } from "../controllers/pet-photos.js";
import { getPet, getPets, postPet, putPet } from "../controllers/shelter-pets.js";
import { deleteSlotHandler, getSlots, postSlot, putSlot } from "../controllers/visit-slots.js";
import { requireRole } from "../middlewares/session.js";

/** Routes of the shelter's own area: every one needs the SHELTER role. */
export function createShelterRouter(): Router {
  const router = Router();
  router.use(requireRole("SHELTER"));

  router.get("/pets", getPets);
  router.post("/pets", postPet);
  router.get("/pets/:id", getPet);
  router.put("/pets/:id", putPet);

  router.get("/pets/:id/photos", getPhotos);
  router.post("/pets/:id/photos", receivePhoto, postPhoto);
  router.put("/pets/:id/photos/order", putPhotoOrder);
  router.delete("/pets/:id/photos/:photoId", deletePhoto);

  router.get("/slots", getSlots);
  router.post("/slots", postSlot);
  router.put("/slots/:id", putSlot);
  router.delete("/slots/:id", deleteSlotHandler);

  return router;
}
