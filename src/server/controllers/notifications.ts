import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { NotificationsResponse, UnreadCountResponse } from "../../shared/api.js";
import { UnauthorizedError } from "../errors.js";
import { listNotifications, markNotificationsRead, unreadCount } from "../services/notification-inbox.js";

const INVALID = "La notificación no es válida.";
const paramsSchema = z.object({
  id: z.coerce.number({ error: INVALID }).int({ error: INVALID }).positive({ error: INVALID }).max(Number.MAX_SAFE_INTEGER, { error: INVALID }),
});

function userId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

/** CU-34 · GET /api/notifications */
export const getNotifications: RequestHandler = async (req, res) => {
  const { notifications, unread } = await listNotifications(userId(req.user));
  const body: NotificationsResponse = {
    notifications: notifications.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    unread,
  };
  res.json(body);
};

/** CU-34 · GET /api/notifications/unread-count (polled by the bell) */
export const getUnreadCount: RequestHandler = async (req, res) => {
  const body: UnreadCountResponse = { unread: await unreadCount(userId(req.user)) };
  res.json(body);
};

/** CU-34 · POST /api/notifications/read */
export const postReadAll: RequestHandler = async (req, res) => {
  const body: UnreadCountResponse = { unread: await markNotificationsRead(userId(req.user)) };
  res.json(body);
};

/** CU-34 · POST /api/notifications/:id/read */
export const postReadOne: RequestHandler = async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  const body: UnreadCountResponse = { unread: await markNotificationsRead(userId(req.user), id) };
  res.json(body);
};
