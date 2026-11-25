import type { DiscoverResponse, GalleryPet } from "../../shared/api.js";
import { currentUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { discardPet, favoritePet, getDiscover, undoDiscard } from "../api/discover.js";
import { ageLabel } from "../age.js";
import { appLayout } from "../components/app-layout.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount } from "../dom.js";
import { navigate } from "../router.js";
import { exploreTabs } from "./gallery.js";

const SIZE_LABELS: Record<GalleryPet["size"], string> = { SMALL: "Pequeño", MEDIUM: "Mediano", LARGE: "Grande" };
const SEX_LABELS: Record<GalleryPet["sex"], string> = { MALE: "Macho", FEMALE: "Hembra" };

/** How far (px) the card has to be dragged to count as a swipe. */
const SWIPE_DISTANCE = 120;

function swipeCard(pet: GalleryPet): HTMLElement {
  return h(
    "article",
    { class: "card swipe-card" },
    pet.photoUrl
      ? h("img", { class: "swipe-card__photo", src: pet.photoUrl, alt: `Foto de ${pet.name}`, draggable: "false" })
      : h("div", { class: "swipe-card__photo pet-card__photo--empty", "aria-hidden": "true" }, "🐾"),
    h(
      "div",
      { class: "swipe-card__info" },
      h("p", { class: "overline" }, pet.shelterName),
      h("h2", { class: "swipe-card__name" }, pet.name),
      h("p", { class: "muted" }, `${ageLabel(pet.birthDate)} · ${SEX_LABELS[pet.sex]} · ${SIZE_LABELS[pet.size]}`),
      h("a", { class: "button button--primary button--small", href: `/mascotas/${String(pet.id)}` }, "Ver ficha →"),
    ),
  );
}

/** CU-10: one pet at a time; swipe (or buttons / arrow keys) left to discard, right to favourite. */
function discoverContent(initial: DiscoverResponse): HTMLElement {
  const area = h("div", { class: "discover" });
  let busy = false;
  // RN-191: only the discard just made can be undone, so the button shows right after it.
  let undoPetId: number | null = null;

  const run = async (action: () => Promise<DiscoverResponse>, undoable: number | null): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const next = await action();
      undoPetId = undoable;
      draw(next);
    } catch (error) {
      undoPetId = null;
      draw(await getDiscover().catch(() => initial), notice("error", error instanceof ApiError ? error.message : "No se ha podido guardar."));
    } finally {
      busy = false;
    }
  };

  const draw = (state: DiscoverResponse, message?: Node): void => {
    const { pet } = state;
    const undoButton =
      undoPetId === null
        ? null
        : h("button", { type: "button", class: "button button--secondary button--small" }, "↶ Deshacer el descarte");
    const lastDiscard = undoPetId;
    undoButton?.addEventListener("click", () => {
      if (lastDiscard !== null) void run(() => undoDiscard(lastDiscard), null);
    });

    const invitation = state.hasPreferences
      ? null
      : notice(
          "info",
          "Aún no has rellenado el cuestionario",
          "Te mostramos todas las mascotas disponibles. Rellena tus preferencias para que te recomendemos las más compatibles.",
        );

    if (!pet) {
      area.replaceChildren(
        ...[message, invitation].filter((node): node is Node => Boolean(node)),
        notice("info", "No quedan mascotas compatibles por valorar.", "Vuelve más adelante o revisa tus preferencias."),
        h("div", { class: "discover__footer" }, undoButton, h("a", { href: "/perfil/preferencias" }, "Editar preferencias")),
      );
      return;
    }

    const card = swipeCard(pet);
    const discard = (): void => void run(() => discardPet(pet.id), pet.id);
    const favorite = (): void => void run(() => favoritePet(pet.id), null);

    // Drag the card: far enough left discards, far enough right favourites.
    let startX: number | null = null;
    card.addEventListener("pointerdown", (event) => {
      if (event.target instanceof Element && event.target.closest("a")) return;
      startX = event.clientX;
      card.setPointerCapture(event.pointerId);
    });
    card.addEventListener("pointermove", (event) => {
      if (startX === null) return;
      const dx = event.clientX - startX;
      card.style.transform = `translateX(${String(dx)}px) rotate(${String(dx / 20)}deg)`;
    });
    card.addEventListener("pointerup", (event) => {
      if (startX === null) return;
      const dx = event.clientX - startX;
      startX = null;
      card.style.transform = "";
      if (dx <= -SWIPE_DISTANCE) discard();
      else if (dx >= SWIPE_DISTANCE) favorite();
    });

    const discardButton = h("button", { type: "button", class: "discover__action", "aria-label": "Descartar" }, "✕");
    const favoriteButton = h("button", { type: "button", class: "discover__action", "aria-label": "Añadir a favoritos" }, "♥");
    discardButton.addEventListener("click", discard);
    favoriteButton.addEventListener("click", favorite);

    area.onkeydown = (event: KeyboardEvent): void => {
      if (event.key === "ArrowLeft") discard();
      if (event.key === "ArrowRight") favorite();
    };

    area.replaceChildren(
      ...[message, invitation].filter((node): node is Node => Boolean(node)),
      h(
        "div",
        { class: "discover__stage" },
        h("div", { class: "discover__side" }, discardButton, h("span", { class: "overline" }, "← Descartar")),
        card,
        h("div", { class: "discover__side" }, favoriteButton, h("span", { class: "overline" }, "Favorito →")),
      ),
      h("p", { class: "muted discover__hint" }, "Arrastra la tarjeta o usa las flechas del teclado: ← descartar · favorito →"),
      h(
        "div",
        { class: "discover__footer" },
        undoButton,
        h(
          "span",
          { class: "muted" },
          state.hasPreferences
            ? `${state.remaining === 1 ? "Queda 1 mascota compatible" : `Quedan ${String(state.remaining)} mascotas compatibles`} con tus preferencias · `
            : `${state.remaining === 1 ? "Queda 1 mascota" : `Quedan ${String(state.remaining)} mascotas`} · `,
          h("a", { href: "/perfil/preferencias" }, state.hasPreferences ? "Editar preferencias" : "Rellenar el cuestionario"),
        ),
      ),
    );
  };

  area.tabIndex = 0;
  draw(initial);
  return area;
}

/** CU-10 · /descubrir */
export async function renderDiscover(root: HTMLElement): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }
  if (user.role !== "ADOPTER") {
    navigate("/inicio", { replace: true });
    return;
  }

  let content: Node;
  try {
    content = discoverContent(await getDiscover());
  } catch (error) {
    content = notice("error", error instanceof ApiError ? error.message : "No se ha podido cargar el modo descubrir.");
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("p", { class: "overline" }, "Explorar"),
      h("h1", { class: "display" }, "Descubrir"),
      h("p", { class: "muted" }, "Mascotas compatibles contigo, una a una."),
      exploreTabs("discover", user.role),
      content,
    ]),
  );
}
