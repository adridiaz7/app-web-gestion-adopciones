import { h } from "../dom.js";

export const APP_NAME = "Lagun";

/** Logo and name of the app, linking to the start page. */
export function brand(): HTMLElement {
  return h(
    "a",
    { class: "brand", href: "/" },
    h("span", { class: "brand__logo", "aria-hidden": "true" }, "🐾"),
    h(
      "span",
      { class: "brand__text" },
      h("span", { class: "brand__name" }, APP_NAME),
      h("span", { class: "brand__tagline" }, "Adopción responsable"),
    ),
  );
}

export interface AuthPageOptions {
  /** Small upper-case label above the title. */
  overline: string;
  title: string;
  subtitle?: string;
  /** Large icon above the overline. */
  icon?: string;
  back?: { href: string; label: string };
  content: Node[];
}

/** Layout of the access screens: header, a centred card and footer (mockups docs/ux-ui/acceso). */
export function authPage(options: AuthPageOptions): HTMLElement {
  return h(
    "div",
    { class: "auth-page" },
    h(
      "header",
      { class: "auth-page__header" },
      brand(),
      options.back ? h("a", { class: "back-link", href: options.back.href }, `← ${options.back.label}`) : null,
    ),
    h(
      "main",
      { class: "auth-page__main" },
      h(
        "section",
        { class: "card auth-card" },
        options.icon ? h("div", { class: "auth-card__icon", "aria-hidden": "true" }, options.icon) : null,
        h("p", { class: "overline" }, options.overline),
        h("h1", { class: "auth-card__title" }, options.title),
        options.subtitle ? h("p", { class: "auth-card__subtitle" }, options.subtitle) : null,
        ...options.content,
      ),
    ),
    h(
      "footer",
      { class: "auth-page__footer" },
      h("span", {}, `© ${String(new Date().getFullYear())} ${APP_NAME}`),
      h("span", {}, "Privacidad · Términos · Ayuda"),
    ),
  );
}
