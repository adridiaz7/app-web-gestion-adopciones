import type { FavoritePet, GalleryPet, PetStatus } from "../../shared/api.js";
import { currentUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { listDiscards, listFavorites, recoverDiscard, removeFavorite } from "../api/favorites.js";
import { ageLabel } from "../age.js";
import { appLayout } from "../components/app-layout.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount } from "../dom.js";
import { navigate } from "../router.js";

const STATUS_LABELS: Record<Exclude<PetStatus, "AVAILABLE">, string> = { RESERVED: "Reservada", ADOPTED: "Adoptada", UNLISTED: "De baja" };
const SIZE_LABELS: Record<GalleryPet["size"], string> = { SMALL: "Pequeño", MEDIUM: "Mediano", LARGE: "Grande" };
const SEX_LABELS: Record<GalleryPet["sex"], string> = { MALE: "Macho", FEMALE: "Hembra" };

/** A card with an action button below; only available pets link to their profile (RN-188, CU-11). */
function listCard(pet: GalleryPet, status: PetStatus, action: HTMLButtonElement): HTMLElement {
  const photo = pet.photoUrl
    ? h("img", { class: "pet-card__photo", src: pet.photoUrl, alt: `Foto de ${pet.name}`, loading: "lazy" })
    : h("div", { class: "pet-card__photo pet-card__photo--empty", "aria-hidden": "true" }, "🐾");
  const body = h(
    "div",
    { class: "pet-card__body" },
    status === "AVAILABLE" ? null : h("span", { class: `badge badge--${status.toLowerCase()}` }, STATUS_LABELS[status]),
    h("h2", { class: "pet-card__name" }, pet.name),
    h("p", { class: "muted" }, pet.breedName),
    h("p", { class: "muted" }, `${ageLabel(pet.birthDate)} · ${SEX_LABELS[pet.sex]} · ${SIZE_LABELS[pet.size]}`),
    h("p", { class: "pet-card__place" }, `${pet.provinceName} · ${pet.shelterName}`),
  );
  const top = status === "AVAILABLE" ? h("a", { class: "pet-card__link", href: `/mascotas/${String(pet.id)}` }, photo, body) : h("div", {}, photo, body);
  return h("article", { class: "card pet-card" }, top, h("div", { class: "pet-card__actions" }, action));
}

function favoritesContent(initialFavorites: FavoritePet[], initialDiscards: GalleryPet[]): Node[] {
  let favorites = initialFavorites;
  let discards = initialDiscards;
  const message = h("div", {});
  const fail = (error: unknown): void =>
    message.replaceChildren(notice("error", error instanceof ApiError ? error.message : "No se ha podido guardar el cambio."));

  const favoriteGrid = h("div", { class: "pet-grid" });
  const discardGrid = h("div", { class: "pet-grid" });

  const drawFavorites = (): void => {
    favoriteGrid.replaceChildren(
      ...(favorites.length === 0
        ? [notice("info", "Todavía no tienes favoritas.", "Añádelas desde la galería, la ficha o el modo descubrir.")]
        : favorites.map((pet) => {
            const remove = h("button", { type: "button", class: "button button--secondary button--small" }, "Quitar de favoritos");
            remove.addEventListener("click", () => {
              remove.disabled = true;
              removeFavorite(pet.id).then(() => {
                favorites = favorites.filter((f) => f.id !== pet.id);
                drawFavorites();
              }, fail);
            });
            return listCard(pet, pet.status, remove);
          })),
    );
  };

  const drawDiscards = (): void => {
    discardGrid.replaceChildren(
      ...(discards.length === 0
        ? [h("p", { class: "muted" }, "No tienes mascotas descartadas.")]
        : discards.map((pet) => {
            const recover = h("button", { type: "button", class: "button button--secondary button--small" }, "Recuperar");
            recover.addEventListener("click", () => {
              recover.disabled = true;
              recoverDiscard(pet.id).then(() => {
                discards = discards.filter((d) => d.id !== pet.id);
                drawDiscards();
              }, fail);
            });
            return listCard(pet, "AVAILABLE", recover);
          })),
    );
  };

  drawFavorites();
  drawDiscards();
  return [
    message,
    favoriteGrid,
    h("h2", { class: "section-title" }, "Descartadas"),
    h("p", { class: "muted" }, "Si recuperas una mascota, puede volver a aparecer en el modo descubrir."),
    discardGrid,
  ];
}

/** CU-12 · /favoritos */
export async function renderFavorites(root: HTMLElement): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }
  if (user.role !== "ADOPTER") {
    navigate("/inicio", { replace: true });
    return;
  }

  let content: Node[];
  try {
    const [{ favorites }, { discards }] = await Promise.all([listFavorites(), listDiscards()]);
    content = favoritesContent(favorites, discards);
  } catch (error) {
    content = [notice("error", error instanceof ApiError ? error.message : "No se han podido cargar tus favoritos.")];
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("h1", { class: "display" }, "Favoritos"),
      h("p", { class: "muted" }, "Las mascotas que has guardado."),
      ...content,
    ]),
  );
}
