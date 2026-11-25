import { logout, type SessionUser } from "../api/auth.js";
import { h } from "../dom.js";
import { navigate } from "../router.js";
import { brand } from "./auth-layout.js";
import { notificationBell } from "./notification-bell.js";

const ROLE_LABELS: Record<SessionUser["role"], string> = {
  ADOPTER: "Adoptante",
  SHELTER: "Protectora",
  ADMIN: "Administración",
};

export interface NavItem {
  href: string;
  label: string;
}

/**
 * Layout of the logged-in area: sidebar with the brand, the sections of the role and the
 * account, and the content on the right. Each task adds its sections to `nav`.
 */
export function appLayout(user: SessionUser, nav: NavItem[], content: Node[]): HTMLElement {
  const current = window.location.pathname;
  const logoutButton = h("button", { type: "button", class: "button button--secondary button--small" }, "Cerrar sesión");
  logoutButton.addEventListener("click", () => {
    logoutButton.disabled = true;
    logout()
      .catch(() => undefined)
      .finally(() => {
        navigate("/iniciar-sesion", { replace: true });
      });
  });

  return h(
    "div",
    { class: "app-layout" },
    h(
      "aside",
      { class: "sidebar" },
      brand(),
      h(
        "nav",
        { class: "sidebar__nav", "aria-label": "Secciones" },
        ...nav.map((item) =>
          h("a", { class: "sidebar__link", href: item.href, "aria-current": item.href === current ? "page" : undefined }, item.label),
        ),
      ),
      h(
        "div",
        { class: "sidebar__account" },
        h("p", { class: "sidebar__email" }, user.email),
        h("p", { class: "sidebar__role" }, ROLE_LABELS[user.role]),
        logoutButton,
      ),
    ),
    h("main", { class: "app-layout__main" }, h("div", { class: "app-layout__topbar" }, notificationBell(user)), ...content),
  );
}
