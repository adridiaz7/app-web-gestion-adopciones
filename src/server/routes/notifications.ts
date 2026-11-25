import { Router } from "express";
import { getNotifications, getUnreadCount, postReadAll, postReadOne } from "../controllers/notifications.js";
import { requireAuth } from "../middlewares/session.js";

/** CU-34: every role reads its own notifications (RN-141). */
export function createNotificationsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.get("/", getNotifications);
  router.get("/unread-count", getUnreadCount);
  router.post("/read", postReadAll);
  router.post("/:id/read", postReadOne);
  return router;
}
