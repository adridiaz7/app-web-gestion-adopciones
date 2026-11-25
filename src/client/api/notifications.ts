import type { NotificationsResponse, UnreadCountResponse } from "../../shared/api.js";
import { apiRequest } from "./client.js";

/** CU-34 */
export const listNotifications = () => apiRequest<NotificationsResponse>("GET", "/notifications");

/** CU-34: the counter polled by the bell. */
export const getUnreadCount = () => apiRequest<UnreadCountResponse>("GET", "/notifications/unread-count");

/** CU-34: mark every notification as read. */
export const markAllNotificationsRead = () => apiRequest<UnreadCountResponse>("POST", "/notifications/read");

/** CU-34: mark one notification as read. */
export const markNotificationRead = (id: number) => apiRequest<UnreadCountResponse>("POST", `/notifications/${String(id)}/read`);
