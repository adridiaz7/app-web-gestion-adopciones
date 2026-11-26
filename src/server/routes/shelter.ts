import { Router } from "express";
import { deletePhoto, getPhotos, postPhoto, putPhotoOrder, receivePhoto } from "../controllers/pet-photos.js";
import {
  getCandidates,
  postApproveAdoption,
  postDeliverAdoption,
  postRejectAdoption,
  postReturnAdoption,
  postShelterCancelAdoption,
} from "../controllers/adoptions.js";
import { getShelterAdopter } from "../controllers/shelter-adopters.js";
import { getPet, getPets, postPet, postReactivatePet, postUnlistPet, putPet } from "../controllers/shelter-pets.js";
import { getInbox, postConfirmVisit, postNoShow, postRejectVisit, postShelterCancelVisit } from "../controllers/visits.js";
import { deleteSlotHandler, getSlots, postRecurringSlots, postSlot, putSlot } from "../controllers/visit-slots.js";
import { requireRole } from "../middlewares/session.js";

/** Routes of the shelter's own area: every one needs the SHELTER role. */
export function createShelterRouter(): Router {
  const router = Router();
  router.use(requireRole("SHELTER"));

  router.get("/pets", getPets);
  router.post("/pets", postPet);
  router.get("/pets/:id", getPet);
  router.put("/pets/:id", putPet);
  router.post("/pets/:id/unlist", postUnlistPet);
  router.post("/pets/:id/reactivate", postReactivatePet);
  router.get("/pets/:id/candidates", getCandidates);
  router.post("/adoptions/:id/approve", postApproveAdoption);
  router.post("/adoptions/:id/reject", postRejectAdoption);
  router.post("/adoptions/:id/cancel", postShelterCancelAdoption);
  router.post("/adoptions/:id/deliver", postDeliverAdoption);
  router.post("/adoptions/:id/return", postReturnAdoption);

  router.get("/pets/:id/photos", getPhotos);
  router.post("/pets/:id/photos", receivePhoto, postPhoto);
  router.put("/pets/:id/photos/order", putPhotoOrder);
  router.delete("/pets/:id/photos/:photoId", deletePhoto);

  router.get("/slots", getSlots);
  router.post("/slots", postSlot);
  router.post("/slots/recurring", postRecurringSlots);
  router.put("/slots/:id", putSlot);
  router.delete("/slots/:id", deleteSlotHandler);

  router.get("/inbox", getInbox);
  router.get("/adopters/:id", getShelterAdopter);
  router.post("/visits/:id/confirm", postConfirmVisit);
  router.post("/visits/:id/reject", postRejectVisit);
  router.post("/visits/:id/cancel", postShelterCancelVisit);
  router.post("/visits/:id/no-show", postNoShow);

  return router;
}
