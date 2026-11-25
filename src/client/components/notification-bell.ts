import type { UserNotification } from "../../shared/api.js";
import type { SessionUser } from "../api/auth.js";
import { getUnreadCount, listNotifications, markAllNotificationsRead, markNotificationRead } from "../api/notifications.js";
import { h } from "../dom.js";
import { notificationHref } from "../notification-link.js";

/** How often the counter is refreshed (specifications §5: polling, longer than the chat's). */
const POLL_MS = 60 * 1000;
/** How many notifications the dropdown shows; the rest are on /notificaciones. */
const DROPDOWN_SIZE = 5;

const SVG_NS = "http://www.w3.org/2000/svg";

/** The bell icon, drawn with the current text colour. */
function bellIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ["M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.94 1.94 0 0 0 3.4 0"]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

const WHEN = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** "hace 5 min", "hace 2 h", or the date for older ones. */
export function notificationWhen(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${String(minutes)} min`;
  if (minutes < 24 * 60) return `Hace ${String(Math.floor(minutes / 60))} h`;
  return WHEN.format(new Date(iso));
}

/**
 * CU-34: one notification. Clicking it marks it as read and opens what it links to (RN-142),
 * if there is a screen for it.
 */
export function notificationItem(notification: UserNotification, role: SessionUser["role"], onOpen?: () => void): HTMLElement {
  const href = notificationHref(notification.link, role);
  const item = h(
    href ? "a" : "div",
    { class: `notification${notification.read ? "" : " notification--unread"}`, ...(href ? { href } : {}) },
    h(
      "div",
      { class: "notification__text" },
      h("strong", {}, notification.title),
      h("p", {}, notification.body),
      h("p", { class: "notification__when" }, notificationWhen(notification.createdAt)),
    ),
    notification.read ? null : h("span", { class: "notification__dot", "aria-label": "Sin leer" }),
  );
  // The router opens the link (it handles every internal <a>).
  item.addEventListener("click", () => {
    onOpen?.();
    if (!notification.read) void markNotificationRead(notification.id).catch(() => undefined);
  });
  return item;
}

/**
 * CU-34 · the bell at the top right of the logged-in area, with a dot and the number of unread
 * notifications, refreshed by polling while it is on the page. It opens a dropdown with the
 * latest ones, "Marcar como leídas" and "Ver todas".
 */
export function notificationBell(user: SessionUser): HTMLElement {
  const count = h("span", { class: "bell__count", hidden: true });
  const button = h("button", { type: "button", class: "bell", "aria-label": "Notificaciones", "aria-expanded": "false" }, bellIcon(), count);
  const list = h("div", { class: "bell__list" });
  const markAll = h("button", { type: "button", class: "link-button" }, "Marcar como leídas");
  const panel = h(
    "div",
    { class: "card bell__panel", hidden: true },
    h("div", { class: "bell__header" }, h("strong", {}, "Notificaciones"), markAll),
    list,
    h("a", { class: "bell__all", href: "/notificaciones" }, "Ver todas"),
  );
  const wrapper = h("div", { class: "bell-wrapper" }, button, panel);

  const showCount = (unread: number): void => {
    count.hidden = unread === 0;
    count.textContent = unread > 9 ? "9+" : String(unread);
    button.setAttribute("aria-label", unread === 0 ? "Notificaciones" : `Notificaciones: ${String(unread)} sin leer`);
  };
  const close = (): void => {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  const load = (): void => {
    list.replaceChildren(h("p", { class: "muted bell__empty" }, "Cargando…"));
    listNotifications().then(
      ({ notifications, unread }) => {
        showCount(unread);
        const latest = notifications.slice(0, DROPDOWN_SIZE);
        list.replaceChildren(
          ...(latest.length === 0
            ? [h("p", { class: "muted bell__empty" }, "No tienes notificaciones.")]
            : latest.map((notification) => notificationItem(notification, user.role, close))),
        );
      },
      () => list.replaceChildren(h("p", { class: "muted bell__empty" }, "No se han podido cargar las notificaciones.")),
    );
  };

  button.addEventListener("click", () => {
    if (!panel.hidden) {
      close();
      return;
    }
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    load();
  });
  markAll.addEventListener("click", () => {
    markAllNotificationsRead().then(({ unread }) => {
      showCount(unread);
      load();
    }, () => undefined);
  });

  // Polling: stops by itself once the layout has been replaced by another screen.
  const refresh = (): void => {
    getUnreadCount().then(({ unread }) => {
      showCount(unread);
    }, () => undefined);
  };
  refresh();
  const timer = window.setInterval(() => {
    if (!wrapper.isConnected) {
      window.clearInterval(timer);
      return;
    }
    refresh();
  }, POLL_MS);

  return wrapper;
}
