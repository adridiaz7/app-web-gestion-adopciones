import { Router } from "express";
import { getConversations, getMessages, postChatPhoto, postMessage } from "../controllers/chat.js";
import { receivePhoto } from "../controllers/pet-photos.js";
import { requireRole } from "../middlewares/session.js";

/** CU-33: the chat between an adopter and a shelter. */
export function createChatRouter(): Router {
  const router = Router();
  router.use(requireRole("ADOPTER", "SHELTER"));
  router.get("/", getConversations);
  router.get("/:id/messages", getMessages);
  router.post("/:id/messages", postMessage);
  router.post("/:id/photos", receivePhoto, postChatPhoto);
  return router;
}
