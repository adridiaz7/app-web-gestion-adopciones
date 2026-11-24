import type { Db } from "../db/transaction.js";
import { insertNotification } from "../models/notifications.js";
import { renderNotification, type NotificationParams, type NotificationType } from "./notification-templates.js";

/** RN-142: a notification links at most one item, the one that opens when it is clicked. */
export type NotificationLink = { visitId: number } | { adoptionId: number } | { petId: number } | { incidentId: number };

export interface NewNotification<T extends NotificationType> {
  /** RN-141: adopters and shelters (and the admin) receive notifications. */
  userId: number;
  type: T;
  params: NotificationParams<T>;
  link?: NotificationLink;
}

/**
 * Creates a notification with the texts of its template (RN-143). Pass the transaction
 * client of the action that causes it, so both are saved together (RN-171).
 */
export async function createNotification<T extends NotificationType>(
  db: Db,
  notification: NewNotification<T>,
): Promise<{ id: number }> {
  const { title, body } = renderNotification(notification.type, notification.params);
  const link = notification.link;
  return insertNotification(db, {
    userId: notification.userId,
    type: notification.type,
    title,
    body,
    visitId: link && "visitId" in link ? link.visitId : null,
    adoptionId: link && "adoptionId" in link ? link.adoptionId : null,
    petId: link && "petId" in link ? link.petId : null,
    incidentId: link && "incidentId" in link ? link.incidentId : null,
  });
}
