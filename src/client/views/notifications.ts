import { currentUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { listNotifications, markAllNotificationsRead } from "../api/notifications.js";
import { appLayout } from "../components/app-layout.js";
import { navFor } from "../components/nav.js";
import { notificationItem } from "../components/notification-bell.js";
import { notice } from "../components/notice.js";
import { h, mount } from "../dom.js";
import { navigate } from "../router.js";

/** CU-34 · /notificaciones: every notification of the user; once shown, they become read. */
export async function renderNotifications(root: HTMLElement): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }

  let content: Node;
  try {
    const { notifications, unread } = await listNotifications();
    content =
      notifications.length === 0
        ? notice("info", "No tienes notificaciones.", "Aquí verás los avisos de tus visitas, adopciones y recordatorios.")
        : h("div", { class: "card notification-list" }, ...notifications.map((notification) => notificationItem(notification, user.role)));
    // CU-34: they stay highlighted on this screen, but count as read from now on (also for the bell).
    if (unread > 0) await markAllNotificationsRead().catch(() => undefined);
  } catch (error) {
    content = notice("error", error instanceof ApiError ? error.message : "No se han podido cargar las notificaciones.");
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("h1", { class: "display" }, "Notificaciones"),
      h("p", { class: "muted" }, "Los avisos de la plataforma. Los mensajes de las protectoras están en el chat."),
      content,
    ]),
  );
}
