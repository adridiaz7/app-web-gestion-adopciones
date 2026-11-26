import type { SessionUser } from "../api/auth.js";
import { getAdopterProfile, getShelterProfile } from "../api/profile.js";
import { h } from "../dom.js";

/** The name shown on the card, kept between pages so it is fetched once per session. */
let cached: { userId: number; name: string } | null = null;

/** After editing the profile, the card shows the new name. */
export function rememberProfileName(userId: number, name: string): void {
  cached = { userId, name };
}

async function loadName(user: SessionUser): Promise<string | null> {
  if (cached?.userId === user.id) return cached.name;
  const name = user.role === "ADOPTER" ? (await getAdopterProfile()).profile.firstName : (await getShelterProfile()).profile.name;
  rememberProfileName(user.id, name);
  return name;
}

/**
 * CU-06 · card at the top of the sidebar, "Hola, {nombre} · Ver mi perfil", that opens the
 * profile (the shelter's name in its case). The administrator has no profile to edit.
 */
export function profileCard(user: SessionUser): HTMLElement | null {
  if (user.role === "ADMIN") return null;
  const initial = h("span", { class: "profile-card__avatar", "aria-hidden": "true" }, "·");
  const greeting = h("span", { class: "profile-card__name" }, "Hola");
  const card = h(
    "a",
    { class: "profile-card", href: "/perfil", "aria-current": window.location.pathname === "/perfil" ? "page" : undefined },
    initial,
    h("span", { class: "profile-card__text" }, greeting, h("span", { class: "profile-card__link" }, "Ver mi perfil")),
    h("span", { class: "profile-card__chevron", "aria-hidden": "true" }, "›"),
  );
  loadName(user)
    .then((name) => {
      if (!name) return;
      greeting.textContent = `Hola, ${name}`;
      initial.textContent = name.trim().charAt(0).toUpperCase();
    })
    .catch(() => undefined);
  return card;
}
