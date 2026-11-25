import { getPool } from "../db/pool.js";
import { NotFoundError } from "../errors.js";
import { countUnread, markRead, selectUserNotifications } from "../models/notifications.js";
import type { NotificationLink } from "./notifications.js";

/** How many notifications the list shows (a screen limit, not a business rule). */
const LIST_LIMIT = 100;

export interface UserNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  /** RN-142: the visit, adoption, pet or incident it opens, if any. */
  link: NotificationLink | null;
  read: boolean;
  createdAt: Date;
}

/** CU-34, RN-140, RN-141: the user's notifications, newest first, and how many are unread. */
export async function listNotifications(userId: number): Promise<{ notifications: UserNotification[]; unread: number }> {
  const pool = getPool();
  const [rows, unread] = await Promise.all([selectUserNotifications(pool, userId, LIST_LIMIT), countUnread(pool, userId)]);
  const notifications = rows.map((row) => {
    let link: NotificationLink | null = null;
    if (row.visitId !== null) link = { visitId: row.visitId };
    else if (row.adoptionId !== null) link = { adoptionId: row.adoptionId };
    else if (row.petId !== null) link = { petId: row.petId };
    else if (row.incidentId !== null) link = { incidentId: row.incidentId };
    return { id: row.id, type: row.type, title: row.title, body: row.body, link, read: row.readAt !== null, createdAt: row.createdAt };
  });
  return { notifications, unread };
}

/** CU-34: the counter the screens poll. */
export async function unreadCount(userId: number): Promise<number> {
  return countUnread(getPool(), userId);
}

/** CU-34: the notifications become read (all of the user's, or one). Returns the unread left. */
export async function markNotificationsRead(userId: number, notificationId: number | null = null): Promise<number> {
  const pool = getPool();
  const matched = await markRead(pool, userId, notificationId);
  if (notificationId !== null && matched === 0) throw new NotFoundError("La notificación no existe.");
  return countUnread(pool, userId);
}
