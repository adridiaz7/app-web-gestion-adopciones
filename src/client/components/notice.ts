import { h } from "../dom.js";

export type NoticeKind = "error" | "success" | "info" | "warning";

const ICONS: Record<NoticeKind, string> = { error: "✕", success: "✓", info: "i", warning: "!" };

/** A message with icon, title and text (design system §8: colour never goes alone). */
export function notice(kind: NoticeKind, title: string, text = ""): HTMLElement {
  return h(
    "div",
    { class: `notice notice--${kind}`, role: kind === "error" ? "alert" : "status" },
    h("span", { class: "notice__icon", "aria-hidden": "true" }, ICONS[kind]),
    h("div", {}, h("p", { class: "notice__title" }, title), text ? h("p", { class: "notice__text" }, text) : null),
  );
}
