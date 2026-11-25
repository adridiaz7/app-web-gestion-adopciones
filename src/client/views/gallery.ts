import type { BreedsResponse, GalleryPet, ProvincesResponse } from "../../shared/api.js";
import { currentUser, getProvinces, type SessionUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { listFavorites } from "../api/favorites.js";
import { getBreeds, getGallery } from "../api/pets.js";
import { AGE_CHOICES, ageLabel } from "../age.js";
import { appLayout } from "../components/app-layout.js";
import { brand } from "../components/auth-layout.js";
import { favoriteButton } from "../components/favorite-button.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount } from "../dom.js";
import { galleryQueryString, type GalleryFilterValues } from "../gallery-query.js";

const SIZE_LABELS: Record<GalleryPet["size"], string> = { SMALL: "Pequeño", MEDIUM: "Mediano", LARGE: "Grande" };
const SEX_LABELS: Record<GalleryPet["sex"], string> = { MALE: "Macho", FEMALE: "Hembra" };

type Option = [value: string, label: string];

/** A compact select for the filter bar; the first option ("") means "any". */
function filterSelect(name: keyof GalleryFilterValues, label: string, anyLabel: string, options: Option[]): HTMLSelectElement {
  return h(
    "select",
    { name, class: "filter-select", "aria-label": label },
    h("option", { value: "" }, anyLabel),
    ...options.map(([value, text]) => h("option", { value }, text)),
  );
}

/** RN-187: a visitor who taps a card is invited to sign up. */
function signUpDialog(): HTMLDialogElement {
  const close = h("button", { type: "button", class: "button button--secondary" }, "Ahora no");
  const dialog = h(
    "dialog",
    { class: "card dialog" },
    h("h2", {}, "Regístrate para ver su ficha"),
    h("p", { class: "muted" }, "Con una cuenta de adoptante puedes ver la ficha completa, guardar favoritas y pedir visitas."),
    h(
      "div",
      { class: "dialog__actions" },
      close,
      h("a", { class: "button button--secondary", href: "/iniciar-sesion" }, "Iniciar sesión"),
      h("a", { class: "button button--primary", href: "/registro" }, "Crear cuenta"),
    ),
  );
  close.addEventListener("click", () => dialog.close());
  return dialog;
}

/** With a session the card opens the profile (CU-11); without one, `onOpen` invites to sign up (RN-187). */
export function petCard(pet: GalleryPet, onOpen: (() => void) | null): HTMLElement {
  const photo = pet.photoUrl
    ? h("img", { class: "pet-card__photo", src: pet.photoUrl, alt: `Foto de ${pet.name}`, loading: "lazy" })
    : h("div", { class: "pet-card__photo pet-card__photo--empty", "aria-hidden": "true" }, "🐾");
  const body = h(
    "div",
    { class: "pet-card__body" },
    h("h2", { class: "pet-card__name" }, pet.name),
    h("p", { class: "muted" }, pet.breedName),
    h("p", { class: "muted" }, `${ageLabel(pet.birthDate)} · ${SEX_LABELS[pet.sex]} · ${SIZE_LABELS[pet.size]}`),
    h("p", { class: "pet-card__place" }, `${pet.provinceName} · ${pet.shelterName}`),
  );
  if (!onOpen) return h("a", { class: "card pet-card pet-card--button", href: `/mascotas/${String(pet.id)}` }, photo, body);

  const card = h("button", { type: "button", class: "card pet-card pet-card--button", "aria-label": `Ver a ${pet.name}` }, photo, body);
  card.addEventListener("click", onOpen);
  return card;
}

/** The filter bar and the results, which reload on every change. */
function galleryContent(catalogue: BreedsResponse, provinces: ProvincesResponse, user: SessionUser | null): Node[] {
  const species = filterSelect(
    "speciesId",
    "Especie",
    "Especie: todas",
    catalogue.species.map((s) => [String(s.id), s.name]),
  );
  const breed = filterSelect("breedId", "Raza", "Raza: todas", []);
  const fillBreeds = (): void => {
    const chosen = catalogue.species.filter((s) => species.value === "" || String(s.id) === species.value);
    breed.replaceChildren(
      h("option", { value: "" }, "Raza: todas"),
      ...chosen.flatMap((s) => s.breeds.map((b) => h("option", { value: String(b.id) }, b.name))),
    );
  };
  fillBreeds();

  const form = h(
    "form",
    { class: "filter-bar", "aria-label": "Filtros" },
    species,
    breed,
    filterSelect("size", "Tamaño", "Tamaño: todos", Object.entries(SIZE_LABELS)),
    filterSelect("sex", "Sexo", "Sexo: todos", Object.entries(SEX_LABELS)),
    filterSelect("minAgeMonths", "Edad mínima", "Edad mínima: sin límite", AGE_CHOICES),
    filterSelect("maxAgeMonths", "Edad máxima", "Edad máxima: sin límite", AGE_CHOICES),
    filterSelect(
      "provinceId",
      "Provincia",
      "Provincia: todas",
      provinces.provinces.map((p) => [String(p.id), p.name]),
    ),
  );

  const count = h("p", { class: "muted" }, "");
  const results = h("div", { class: "pet-grid" });
  const dialog = signUpDialog();
  // RN-187: visitors get the invitation; users with a session open the profile.
  const onOpen = user ? null : () => dialog.showModal();

  // RN-73: adopters get a heart on each card; their current favourites are marked.
  const message = h("div", {});
  const favoriteIds =
    user?.role === "ADOPTER" ? listFavorites().then(({ favorites }) => new Set(favorites.map((f) => f.id)), () => new Set<number>()) : null;
  const cardFor = (pet: GalleryPet, favorites: Set<number> | null): HTMLElement => {
    const card = petCard(pet, onOpen);
    if (!favorites) return card;
    const heart = favoriteButton(pet.id, favorites.has(pet.id), (text) => message.replaceChildren(notice("error", text)));
    return h("div", { class: "pet-card-wrap" }, card, heart);
  };

  let request = 0;
  const load = async (): Promise<void> => {
    const mine = ++request;
    const values = Object.fromEntries(new FormData(form)) as GalleryFilterValues;
    try {
      const [{ pets }, favorites] = await Promise.all([getGallery(galleryQueryString(values)), favoriteIds]);
      if (mine !== request) return;
      count.textContent = pets.length === 1 ? "1 mascota" : `${String(pets.length)} mascotas`;
      results.replaceChildren(
        ...(pets.length === 0
          ? [notice("info", "No hay mascotas disponibles con estos filtros.", "Prueba a quitar alguno.")]
          : pets.map((pet) => cardFor(pet, favorites))),
      );
    } catch (error) {
      if (mine !== request) return;
      count.textContent = "";
      results.replaceChildren(notice("error", error instanceof ApiError ? error.message : "No se han podido cargar las mascotas."));
    }
  };

  species.addEventListener("change", fillBreeds);
  form.addEventListener("change", () => void load());
  form.addEventListener("submit", (event) => event.preventDefault());
  void load();

  return [form, count, message, results, dialog];
}

/** CU-09 · /mascotas: the gallery, open to visitors (RN-187) and to logged-in users. */
export async function renderGallery(root: HTMLElement): Promise<void> {
  const user = await currentUser();

  let content: Node[];
  try {
    const [catalogue, provinces] = await Promise.all([getBreeds(), getProvinces()]);
    content = galleryContent(catalogue, provinces, user);
  } catch (error) {
    content = [notice("error", error instanceof ApiError ? error.message : "No se ha podido cargar la galería.")];
  }

  const heading = [
    h("p", { class: "overline" }, "Explorar"),
    h("h1", { class: "display" }, "Mascotas en adopción"),
    h("p", { class: "muted" }, "Filtra por especie, raza, tamaño, edad, sexo o provincia."),
  ];

  if (user) {
    mount(root, appLayout(user, navFor(user.role), [...heading, exploreTabs("pets", user.role), ...content]));
    return;
  }

  mount(
    root,
    h(
      "div",
      { class: "public-page" },
      h(
        "header",
        { class: "public-page__header" },
        brand(),
        h(
          "nav",
          { class: "public-page__actions" },
          h("a", { class: "button button--secondary button--small", href: "/iniciar-sesion" }, "Iniciar sesión"),
          h("a", { class: "button button--primary button--small", href: "/registro" }, "Crear cuenta"),
        ),
      ),
      h("main", { class: "public-page__main" }, ...heading, ...content),
    ),
  );
}

/** Tabs of "Explorar" for users with a session (CU-10 only for adopters, CU-09, CU-13). */
export function exploreTabs(current: "discover" | "pets" | "shelters", role: SessionUser["role"]): HTMLElement {
  const tab = (href: string, label: string, active: boolean) =>
    h("a", { class: "tabs__tab", href, "aria-current": active ? "page" : undefined }, label);
  return h(
    "nav",
    { class: "tabs", "aria-label": "Explorar" },
    role === "ADOPTER" ? tab("/descubrir", "Descubrir", current === "discover") : null,
    tab("/mascotas", "Mascotas", current === "pets"),
    tab("/protectoras", "Protectoras", current === "shelters"),
  );
}
