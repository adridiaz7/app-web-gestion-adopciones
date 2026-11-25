import type { BreedsResponse, PetDataRequest, PetStatus, ShelterPet, UnlistPetRequest, UnlistReason } from "../../shared/api.js";
import { currentUser, type SessionUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { ageLabel } from "../age.js";
import { createPet, getBreeds, getMyPet, listMyPets, reactivatePet, unlistPet, updatePet } from "../api/pets.js";
import { appLayout } from "../components/app-layout.js";
import { checked, field, onSubmit, selectField, submitButton, textValue } from "../components/form.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount } from "../dom.js";
import { petPhotosSection } from "../components/pet-photos.js";
import { navigate, type RouteParams } from "../router.js";

const STATUS_LABELS: Record<PetStatus, string> = {
  AVAILABLE: "Disponible",
  RESERVED: "Reservada",
  ADOPTED: "Adoptada",
  UNLISTED: "De baja",
};

/** RN-62: the reasons for unlisting a pet. */
const UNLIST_REASONS: Record<UnlistReason, string> = {
  DECEASED: "Fallecimiento",
  TRANSFERRED: "Traslado",
  TREATMENT: "Tratamiento",
  FOSTER: "Acogida",
  ERROR: "Error",
  OTHER: "Otro",
  REMOVED_BY_ADMIN: "Retirada por el administrador",
};

const statusText = (pet: ShelterPet): string =>
  pet.unlistReason ? `${STATUS_LABELS[pet.status]} · ${UNLIST_REASONS[pet.unlistReason]}` : STATUS_LABELS[pet.status];

/**
 * CU-17: unlist an available pet choosing a reason (RN-61, RN-62), or reactivate an unlisted
 * one unless the administrator removed it (RN-63, RN-64). `onChange` reloads the page.
 */
function petStatusSection(pet: ShelterPet, onChange: () => void): HTMLElement {
  const message = h("div", {});
  const section = h("section", { class: "card pet-status" }, h("h2", {}, "Estado de la ficha"));
  const fail = (error: unknown, fallback: string): void => {
    message.replaceChildren(notice("error", error instanceof ApiError ? error.message : fallback));
  };

  if (pet.status === "AVAILABLE") {
    const reasons = (Object.keys(UNLIST_REASONS) as UnlistReason[]).filter((reason) => reason !== "REMOVED_BY_ADMIN");
    const select = h(
      "select",
      { name: "reason", required: true },
      h("option", { value: "" }, "Elige el motivo"),
      ...reasons.map((reason) => h("option", { value: reason }, UNLIST_REASONS[reason])),
    );
    const button = h("button", { type: "submit", class: "button button--secondary" }, "Dar de baja");
    const form = h("form", { class: "pet-status__form" }, h("label", { class: "field" }, "Motivo de la baja", select), button);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!select.value) return;
      if (!window.confirm(`¿Dar de baja a ${pet.name}? Sus visitas y solicitudes de adopción abiertas se anularán y se avisará a los adoptantes.`)) return;
      button.disabled = true;
      unlistPet(pet.id, { reason: select.value as UnlistPetRequest["reason"] }).then(onChange, (error: unknown) => {
        button.disabled = false;
        fail(error, "No se ha podido dar de baja la mascota.");
      });
    });
    section.append(
      h("p", { class: "muted" }, "La baja oculta la ficha a los adoptantes. Podrás reactivarla más adelante."),
      form,
    );
  } else if (pet.status === "UNLISTED" && pet.unlistReason !== "REMOVED_BY_ADMIN") {
    const button = h("button", { type: "button", class: "button button--primary" }, "Reactivar");
    button.addEventListener("click", () => {
      button.disabled = true;
      reactivatePet(pet.id).then(onChange, (error: unknown) => {
        button.disabled = false;
        fail(error, "No se ha podido reactivar la mascota.");
      });
    });
    section.append(
      h("p", {}, `De baja por: ${UNLIST_REASONS[pet.unlistReason ?? "OTHER"]}. Al reactivarla volverá a estar disponible y avisaremos a los adoptantes cuyas visitas o solicitudes se anularon.`),
      button,
    );
  } else if (pet.status === "UNLISTED") {
    section.append(notice("info", "El administrador ha retirado esta mascota.", "No se puede reactivar desde aquí."));
  } else if (pet.status === "RESERVED") {
    section.append(h("p", { class: "muted" }, "Está reservada. Para darla de baja, primero cancela la adopción aprobada."));
  } else {
    section.append(h("p", { class: "muted" }, "Ya ha sido adoptada."));
  }
  section.append(message);
  return section;
}

/** Only shelters: anyone else is sent away. Returns the user, or null after redirecting. */
async function shelterOnly(): Promise<SessionUser | null> {
  const user = await currentUser();
  if (!user) navigate("/iniciar-sesion", { replace: true });
  else if (user.role !== "SHELTER") navigate("/inicio", { replace: true });
  return user?.role === "SHELTER" ? user : null;
}

/** CU-14 · /protectora/mascotas */
export async function renderMyPets(root: HTMLElement): Promise<void> {
  const user = await shelterOnly();
  if (!user) return;

  let content: Node;
  try {
    const { pets } = await listMyPets();
    content =
      pets.length === 0
        ? notice("info", "Todavía no has dado de alta ninguna mascota.", "Pulsa «Dar de alta una mascota» para publicar la primera.")
        : h(
            "div",
            { class: "pet-list" },
            ...pets.map((pet) =>
              h(
                "a",
                { class: "card pet-row", href: `/protectora/mascotas/${String(pet.id)}` },
                h("span", { class: "pet-row__name" }, pet.name),
                h("span", { class: "muted" }, `${pet.speciesName} · ${pet.breedName} · ${ageLabel(pet.birthDate)}`),
                h("span", { class: `badge badge--${pet.status.toLowerCase()}` }, statusText(pet)),
              ),
            ),
          );
  } catch (error) {
    content = notice("error", error instanceof ApiError ? error.message : "No se han podido cargar tus mascotas.");
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("p", { class: "overline" }, "Protectora"),
      h(
        "div",
        { class: "page-title" },
        h("h1", { class: "display" }, "Mis mascotas"),
        h("a", { class: "button button--primary", href: "/protectora/mascotas/nueva" }, "Dar de alta una mascota"),
      ),
      content,
    ]),
  );
}

function radioGroup(name: string, legend: string, choices: [string, string][], value: string | undefined): HTMLElement {
  return h(
    "fieldset",
    { class: "field radio-group", "data-field": name },
    h("legend", {}, legend),
    h(
      "div",
      { class: "radio-group__options" },
      ...choices.map(([optionValue, label]) =>
        h("label", { class: "checkbox" }, h("input", { type: "radio", name, value: optionValue, checked: optionValue === value }), label),
      ),
    ),
    h("p", { class: "field__error" }),
  );
}

function checkbox(name: string, label: string, isChecked: boolean): HTMLElement {
  return h("label", { class: "checkbox" }, h("input", { type: "checkbox", name, checked: isChecked }), h("span", {}, label));
}

function petForm(catalogue: BreedsResponse, pet: ShelterPet | null, save: (data: PetDataRequest) => Promise<void>): HTMLFormElement {
  const breedChoices = catalogue.species.flatMap((species) =>
    species.breeds.map((breed) => ({ value: String(breed.id), label: `${species.name} · ${breed.name}` })),
  );
  const breed = selectField("breedId", "Especie y raza", breedChoices);
  const breedSelect = breed.querySelector("select");
  if (breedSelect && pet) breedSelect.value = String(pet.breedId);

  const getsAlong = (speciesId: number) => pet?.getsAlongWith.find((g) => g.speciesId === speciesId);
  const description = h("textarea", { name: "description", rows: "5", maxlength: "3000" });
  description.value = pet?.description ?? "";
  const specialNeeds = h("textarea", { name: "specialNeeds", rows: "2", maxlength: "1000" });
  specialNeeds.value = pet?.specialNeeds ?? "";

  const form = h(
    "form",
    { class: "form card pet-form" },
    h("div", { class: "form__row" }, field({ name: "name", label: "Nombre", value: pet?.name }), breed),
    h(
      "div",
      { class: "field", "data-field": "description" },
      h("label", {}, "Descripción", description),
      h("p", { class: "field__error" }),
    ),
    field({ name: "birthDate", label: "Fecha de nacimiento aproximada", type: "date", value: pet?.birthDate }),
    radioGroup("sex", "Sexo", [["MALE", "Macho"], ["FEMALE", "Hembra"]], pet?.sex),
    radioGroup("size", "Tamaño", [["SMALL", "Pequeño"], ["MEDIUM", "Mediano"], ["LARGE", "Grande"]], pet?.size),
    radioGroup("activityLevel", "Nivel de actividad", [["LOW", "Bajo"], ["MEDIUM", "Medio"], ["HIGH", "Alto"]], pet?.activityLevel),
    radioGroup("goodWithChildren", "Convivencia con niños", [["YES", "Sí"], ["NO", "No"], ["UNKNOWN", "No se sabe"]], pet?.goodWithChildren ?? "UNKNOWN"),
    ...catalogue.species.map((species) => {
      const current = getsAlong(species.id);
      return radioGroup(
        `getsAlong-${String(species.id)}`,
        `Convivencia con ${species.name.toLowerCase()}s`,
        [["YES", "Sí"], ["NO", "No"], ["UNKNOWN", "No se sabe"]],
        current ? (current.getsAlong ? "YES" : "NO") : "UNKNOWN",
      );
    }),
    h(
      "fieldset",
      { class: "field" },
      h("legend", {}, "Salud"),
      checkbox("vaccinated", "Vacunada", pet?.vaccinated ?? false),
      checkbox("dewormed", "Desparasitada", pet?.dewormed ?? false),
      checkbox("sterilized", "Esterilizada", pet?.sterilized ?? false),
      checkbox("microchipped", "Con microchip", pet?.microchipped ?? false),
    ),
    h(
      "div",
      { class: "field", "data-field": "specialNeeds" },
      h("label", {}, "Necesidades especiales (opcional)", specialNeeds),
      h("p", { class: "field__error" }),
    ),
    submitButton(pet ? "Guardar cambios" : "Dar de alta"),
  );

  onSubmit(form, async () => {
    const radio = (name: string) => textValue(form, name);
    await save({
      name: textValue(form, "name"),
      breedId: Number(textValue(form, "breedId")) || 0,
      description: textValue(form, "description"),
      birthDate: textValue(form, "birthDate"),
      sex: radio("sex") as PetDataRequest["sex"],
      size: radio("size") as PetDataRequest["size"],
      activityLevel: radio("activityLevel") as PetDataRequest["activityLevel"],
      goodWithChildren: radio("goodWithChildren") as PetDataRequest["goodWithChildren"],
      getsAlongWith: catalogue.species.flatMap((species) => {
        const answer = radio(`getsAlong-${String(species.id)}`);
        return answer === "YES" || answer === "NO" ? [{ speciesId: species.id, getsAlong: answer === "YES" }] : [];
      }),
      vaccinated: checked(form, "vaccinated"),
      dewormed: checked(form, "dewormed"),
      sterilized: checked(form, "sterilized"),
      microchipped: checked(form, "microchipped"),
      specialNeeds: textValue(form, "specialNeeds") || null,
    });
  });
  return form;
}

/** CU-15 · /protectora/mascotas/nueva and CU-16 · /protectora/mascotas/:id */
export async function renderPetForm(root: HTMLElement, params: RouteParams): Promise<void> {
  const user = await shelterOnly();
  if (!user) return;

  const petId = params["id"] ? Number(params["id"]) : null;
  let body: Node[];
  try {
    const [catalogue, pet] = await Promise.all([getBreeds(), petId ? getMyPet(petId).then((r) => r.pet) : Promise.resolve(null)]);
    const form = petForm(catalogue, pet, async (data) => {
      if (pet) {
        await updatePet(pet.id, data);
        form.querySelector(".form-result")?.remove();
        const saved = notice("success", "Cambios guardados");
        saved.classList.add("form-result");
        form.prepend(saved);
      } else {
        const created = await createPet(data);
        navigate(`/protectora/mascotas/${String(created.pet.id)}`, { replace: true });
      }
    });
    body = pet
      ? [
          h("p", { class: "muted" }, `Estado: ${statusText(pet)} · Alta: ${new Date(pet.createdAt).toLocaleDateString("es-ES")}`),
          petStatusSection(pet, () => void renderPetForm(root, params)),
          petPhotosSection(pet.id),
          form,
        ]
      : [form];
  } catch (error) {
    body = [notice("error", error instanceof ApiError ? error.message : "No se ha podido cargar la mascota.")];
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("a", { class: "back-link", href: "/protectora/mascotas" }, "← Mis mascotas"),
      h("h1", { class: "display" }, petId ? "Editar mascota" : "Dar de alta una mascota"),
      ...body,
    ]),
  );
}
