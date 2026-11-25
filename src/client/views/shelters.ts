import type { ProvincesResponse, ShelterCard, ShelterPageResponse } from "../../shared/api.js";
import { currentUser, getProvinces, type SessionUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { getShelterPage, searchShelters } from "../api/shelters.js";
import { blockNoticeText } from "../block-notice.js";
import { appLayout } from "../components/app-layout.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount } from "../dom.js";
import { navigate, type RouteParams } from "../router.js";
import { exploreTabs, petCard } from "./gallery.js";

/** RN-187: searching shelters needs a session. Returns the user, or null after redirecting. */
async function loggedIn(): Promise<SessionUser | null> {
  const user = await currentUser();
  if (!user) navigate("/iniciar-sesion", { replace: true });
  return user;
}

/** Initials for the avatar when the shelter has no logo ("Huellas de Valencia" → "HV"). */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => /^\p{Lu}/u.test(word))
    .slice(0, 2)
    .map((word) => word[0])
    .join("") || name.slice(0, 1).toUpperCase();
}

function avatar(name: string, logoUrl: string | null, size: "" | "--large" = ""): HTMLElement {
  return logoUrl
    ? h("img", { class: `shelter-avatar shelter-avatar${size}`, src: logoUrl, alt: "" })
    : h("span", { class: `shelter-avatar shelter-avatar${size}`, "aria-hidden": "true" }, initials(name));
}

function shelterCard(shelter: ShelterCard): HTMLElement {
  return h(
    "a",
    { class: "card shelter-card", href: `/protectoras/${String(shelter.id)}` },
    avatar(shelter.name, shelter.logoUrl),
    h(
      "div",
      { class: "shelter-card__body" },
      h("h2", { class: "pet-card__name" }, shelter.name),
      h("p", { class: "muted" }, `${shelter.locality} (${shelter.provinceName})`),
      shelter.description ? h("p", { class: "shelter-card__description" }, shelter.description) : null,
      h("p", { class: "muted" }, shelter.availablePets === 1 ? "1 mascota disponible" : `${String(shelter.availablePets)} mascotas disponibles`),
    ),
  );
}

function searchContent(provinces: ProvincesResponse): Node[] {
  const name = h("input", { type: "search", name: "name", class: "filter-search", placeholder: "Buscar protectora por nombre", "aria-label": "Nombre", maxlength: "100" });
  const province = h(
    "select",
    { name: "provinceId", class: "filter-select", "aria-label": "Provincia" },
    h("option", { value: "" }, "Provincia: todas"),
    ...provinces.provinces.map((p) => h("option", { value: String(p.id) }, p.name)),
  );
  const form = h("form", { class: "filter-bar", role: "search" }, name, province);
  const count = h("p", { class: "muted" }, "");
  const results = h("div", { class: "shelter-grid" });

  let request = 0;
  const load = async (): Promise<void> => {
    const mine = ++request;
    try {
      const { shelters } = await searchShelters(name.value.trim(), province.value);
      if (mine !== request) return;
      count.textContent = shelters.length === 1 ? "1 protectora" : `${String(shelters.length)} protectoras`;
      results.replaceChildren(
        ...(shelters.length === 0 ? [notice("info", "No hay protectoras que cumplan los filtros.", "Prueba con otro nombre o provincia.")] : shelters.map(shelterCard)),
      );
    } catch (error) {
      if (mine !== request) return;
      count.textContent = "";
      results.replaceChildren(notice("error", error instanceof ApiError ? error.message : "No se han podido cargar las protectoras."));
    }
  };

  let typing: ReturnType<typeof setTimeout> | undefined;
  name.addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => void load(), 300);
  });
  province.addEventListener("change", () => void load());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void load();
  });
  void load();
  return [form, count, results];
}

/** CU-13 · /protectoras: search for shelters (RN-69). */
export async function renderShelterSearch(root: HTMLElement): Promise<void> {
  const user = await loggedIn();
  if (!user) return;

  let content: Node[];
  try {
    content = searchContent(await getProvinces());
  } catch (error) {
    content = [notice("error", error instanceof ApiError ? error.message : "No se han podido cargar las protectoras.")];
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("p", { class: "overline" }, "Explorar"),
      h("h1", { class: "display" }, "Protectoras"),
      h("p", { class: "muted" }, "Busca protectoras por nombre o provincia y conoce a sus mascotas."),
      exploreTabs("shelters"),
      ...content,
    ]),
  );
}

function contactRow(label: string, value: string | null): HTMLElement | null {
  return value ? h("div", { class: "facts__item" }, h("dt", {}, label), h("dd", {}, value)) : null;
}

function profileContent({ shelter, block, pets }: ShelterPageResponse): Node[] {
  return [
    h(
      "section",
      { class: "card shelter-header" },
      avatar(shelter.name, shelter.logoUrl, "--large"),
      h(
        "div",
        {},
        h("h1", { class: "display" }, shelter.name),
        h("p", { class: "muted" }, `${shelter.locality} (${shelter.provinceName})`),
        h("span", { class: "badge badge--available" }, "Validada"),
      ),
    ),
    // RN-149: neutral notice while the shelter restricts this adopter's access.
    block ? notice("warning", "Acceso restringido", blockNoticeText(shelter.name, block.endsAt)) : null,
    h(
      "div",
      { class: "shelter-info" },
      h("section", { class: "card" }, h("h2", { class: "overline" }, "Sobre la protectora"), h("p", { class: "profile__description" }, shelter.description ?? "Esta protectora aún no ha añadido una descripción.")),
      h(
        "section",
        { class: "card" },
        h("h2", { class: "overline" }, "Contacto"),
        h(
          "dl",
          { class: "contact-list" },
          contactRow("Dirección", `${shelter.address} · ${shelter.locality}`),
          contactRow("Teléfono", shelter.phone),
          contactRow("Email", shelter.contactEmail),
          contactRow("Web", shelter.website),
          contactRow("Horario", shelter.openingHours),
        ),
      ),
    ),
    block
      ? null
      : h(
          "section",
          {},
          h("h2", {}, `Mascotas disponibles (${String(pets.length)})`),
          pets.length === 0
            ? notice("info", "Esta protectora no tiene mascotas disponibles ahora mismo.")
            : h("div", { class: "pet-grid" }, ...pets.map((pet) => petCard(pet, null))),
        ),
  ].filter((node): node is HTMLElement => node !== null);
}

/** CU-13 · /protectoras/:id: a shelter's profile and its pets. */
export async function renderShelterProfile(root: HTMLElement, params: RouteParams): Promise<void> {
  const user = await loggedIn();
  if (!user) return;

  let content: Node[];
  try {
    content = profileContent(await getShelterPage(Number(params["id"])));
  } catch (error) {
    content = [notice("error", error instanceof ApiError ? error.message : "No se ha podido cargar la protectora.")];
  }

  mount(root, appLayout(user, navFor(user.role), [h("a", { class: "back-link", href: "/protectoras" }, "← Volver a protectoras"), ...content]));
}
