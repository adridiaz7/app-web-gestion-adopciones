import type { PetProfile } from "../../shared/api.js";
import { currentUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { getPetProfile } from "../api/pets.js";
import { ageLabel } from "../age.js";
import { appLayout } from "../components/app-layout.js";
import { authPage } from "../components/auth-layout.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount } from "../dom.js";
import type { RouteParams } from "../router.js";

const SIZE_LABELS: Record<PetProfile["size"], string> = { SMALL: "Pequeño", MEDIUM: "Mediano", LARGE: "Grande" };
const SEX_LABELS: Record<PetProfile["sex"], string> = { MALE: "Macho", FEMALE: "Hembra" };
const ACTIVITY_LABELS: Record<PetProfile["activityLevel"], string> = { LOW: "Baja", MEDIUM: "Media", HIGH: "Alta" };
const CHILDREN_LABELS: Record<PetProfile["goodWithChildren"], string> = { YES: "Sí", NO: "No", UNKNOWN: "Desconocido" };

const yesNo = (value: boolean): string => (value ? "Sí" : "No");

/** A grid of label/value pairs (the "Características" table of the mockup). */
function facts(rows: [string, string][]): HTMLElement {
  return h(
    "dl",
    { class: "facts" },
    ...rows.map(([label, value]) => h("div", { class: "facts__item" }, h("dt", {}, label), h("dd", {}, value))),
  );
}

/** The main photo and its thumbnails; tapping a thumbnail shows it big (RN-51: the first is the main one). */
function photoGallery(pet: PetProfile): HTMLElement {
  const [first] = pet.photos;
  if (!first) return h("div", { class: "profile-photo profile-photo--empty", "aria-hidden": "true" }, "🐾");

  const main = h("img", { class: "profile-photo", src: first.url, alt: `Foto de ${pet.name}` });
  const thumbs = pet.photos.map((photo, index) => {
    const thumb = h(
      "button",
      { type: "button", class: "profile-thumb", "aria-label": `Ver la foto ${String(index + 1)}`, "aria-pressed": index === 0 ? "true" : "false" },
      h("img", { src: photo.url, alt: "", loading: "lazy" }),
    );
    thumb.addEventListener("click", () => {
      main.src = photo.url;
      thumbs.forEach((other) => other.setAttribute("aria-pressed", other === thumb ? "true" : "false"));
    });
    return thumb;
  });
  return h("div", {}, main, pet.photos.length > 1 ? h("div", { class: "profile-thumbs" }, ...thumbs) : null);
}

function profileContent(pet: PetProfile): Node[] {
  // RN-46: species without a record are unknown, so they are not listed.
  const livesWith: [string, string][] = pet.getsAlongWith.map((g) => [`Con ${g.speciesName.toLowerCase()}s`, g.getsAlong ? "Se lleva bien" : "No se lleva bien"]);

  return [
    h("a", { class: "back-link", href: "/mascotas" }, "← Volver a explorar"),
    h(
      "div",
      { class: "profile" },
      h(
        "div",
        { class: "profile__main" },
        photoGallery(pet),
        h("h2", { class: "overline" }, `Sobre ${pet.name}`),
        h("p", { class: "profile__description" }, pet.description),
        h("h2", { class: "overline" }, "Características"),
        facts([
          ["Especie", pet.speciesName],
          ["Raza", pet.breedName],
          ["Edad", ageLabel(pet.birthDate)],
          ["Sexo", SEX_LABELS[pet.sex]],
          ["Tamaño", SIZE_LABELS[pet.size]],
          ["Nivel de actividad", ACTIVITY_LABELS[pet.activityLevel]],
        ]),
        h("h2", { class: "overline" }, "Convivencia"),
        facts([["Con niños", CHILDREN_LABELS[pet.goodWithChildren]], ...livesWith]),
        livesWith.length === 0 ? h("p", { class: "muted" }, "No se sabe cómo se lleva con otros animales.") : null,
        h("h2", { class: "overline" }, "Salud"),
        facts([
          ["Vacunada", yesNo(pet.vaccinated)],
          ["Desparasitada", yesNo(pet.dewormed)],
          ["Esterilizada", yesNo(pet.sterilized)],
          ["Microchip", yesNo(pet.microchipped)],
          ["Necesidades especiales", pet.specialNeeds ?? "Ninguna"],
        ]),
      ),
      h(
        "aside",
        { class: "card profile__side" },
        h("p", { class: "overline" }, pet.shelter.name),
        h("h1", { class: "display" }, pet.name),
        h("p", { class: "muted" }, `${pet.breedName} · ${ageLabel(pet.birthDate)} · ${SEX_LABELS[pet.sex]} · ${SIZE_LABELS[pet.size]}`),
        h("p", {}, h("span", { class: "badge badge--available" }, "Disponible"), ` ${pet.shelter.locality} (${pet.shelter.provinceName})`),
      ),
    ),
  ];
}

/** CU-11 · /mascotas/:id: only with a session (RN-188). */
export async function renderPetProfile(root: HTMLElement, params: RouteParams): Promise<void> {
  const user = await currentUser();
  if (!user) {
    // RN-188, CU-11: no public profiles; the visitor is invited to sign up or log in.
    mount(
      root,
      authPage({
        overline: "Ficha de la mascota",
        title: "Regístrate para ver esta ficha",
        subtitle: "Las fichas de las mascotas solo se pueden ver con una cuenta.",
        back: { href: "/mascotas", label: "Volver a la galería" },
        content: [
          h(
            "div",
            { class: "dialog__actions" },
            h("a", { class: "button button--secondary", href: "/iniciar-sesion" }, "Iniciar sesión"),
            h("a", { class: "button button--primary", href: "/registro" }, "Crear cuenta"),
          ),
        ],
      }),
    );
    return;
  }

  let content: Node[];
  try {
    const { pet } = await getPetProfile(Number(params["id"]));
    content = profileContent(pet);
  } catch (error) {
    content = [
      h("a", { class: "back-link", href: "/mascotas" }, "← Volver a explorar"),
      notice("error", error instanceof ApiError ? error.message : "No se ha podido cargar la ficha."),
    ];
  }
  mount(root, appLayout(user, navFor(user.role), content));
}
