import type { BreedsResponse, Preferences } from "../../shared/api.js";
import { currentUser, type SessionUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { getPreferences, savePreferences } from "../api/preferences.js";
import { getBreeds } from "../api/pets.js";
import { AGE_CHOICES } from "../age.js";
import { appLayout } from "../components/app-layout.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount } from "../dom.js";
import { navigate } from "../router.js";

type Choice = [value: string, label: string];

const SIZES: Choice[] = [["SMALL", "Pequeño"], ["MEDIUM", "Mediano"], ["LARGE", "Grande"]];
const SEXES: Choice[] = [["MALE", "Macho"], ["FEMALE", "Hembra"]];
const ACTIVITY: Choice[] = [["LOW", "Baja"], ["MEDIUM", "Media"], ["HIGH", "Alta"]];

/**
 * RN-33: a question with several answers and "Me da igual". "Me da igual" is on when no
 * answer is chosen, and choosing it clears the others (RN-35).
 */
function chipGroup(name: string, choices: Choice[], selected: string[]): HTMLElement {
  const any = h("input", { type: "checkbox", class: "chip__input", checked: selected.length === 0 });
  const group = h("div", { class: "chips", role: "group" });

  const sync = (): void => {
    any.checked = group.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`).length === 0;
  };
  any.addEventListener("change", () => {
    group.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((input) => (input.checked = false));
    any.checked = true;
  });

  group.append(
    h("label", { class: "chip" }, any, h("span", {}, "Me da igual")),
    ...choices.map(([value, label]) => {
      const input = h("input", { type: "checkbox", class: "chip__input", name, value, checked: selected.includes(value) });
      input.addEventListener("change", sync);
      return h("label", { class: "chip" }, input, h("span", {}, label));
    }),
  );
  return group;
}

function question(title: string, hint: string | null, control: HTMLElement): HTMLElement {
  return h("fieldset", { class: "question" }, h("legend", {}, title), hint ? h("p", { class: "muted" }, hint) : null, control);
}

function ageSelect(name: string, label: string, value: number | null): HTMLElement {
  return h(
    "label",
    { class: "age-range__item" },
    h("span", {}, label),
    h(
      "select",
      { name, class: "filter-select" },
      h("option", { value: "" }, "Sin límite"),
      ...AGE_CHOICES.map(([months, text]) => h("option", { value: months, selected: value === Number(months) }, text)),
    ),
  );
}

const values = (form: HTMLFormElement, name: string): string[] =>
  [...form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((input) => input.value);
const ids = (form: HTMLFormElement, name: string): number[] => values(form, name).map(Number);
const months = (form: HTMLFormElement, name: string): number | null => {
  const value = form.querySelector<HTMLSelectElement>(`select[name="${name}"]`)?.value ?? "";
  return value === "" ? null : Number(value);
};

function readForm(form: HTMLFormElement): Preferences {
  return {
    speciesIds: ids(form, "speciesIds"),
    breedIds: ids(form, "breedIds"),
    sizes: values(form, "sizes") as Preferences["sizes"],
    sexes: values(form, "sexes") as Preferences["sexes"],
    activityLevels: values(form, "activityLevels") as Preferences["activityLevels"],
    minAgeMonths: months(form, "minAgeMonths"),
    maxAgeMonths: months(form, "maxAgeMonths"),
    needsGoodWithChildren: form.querySelector<HTMLInputElement>('input[name="needsGoodWithChildren"]')?.checked ?? false,
    mustGetAlongWithSpeciesIds: ids(form, "mustGetAlongWithSpeciesIds"),
  };
}

function preferencesForm(catalogue: BreedsResponse, prefs: Preferences | null): HTMLFormElement {
  const current = prefs;
  const speciesChoices: Choice[] = catalogue.species.map((s) => [String(s.id), s.name]);
  const species = chipGroup("speciesIds", speciesChoices, (current?.speciesIds ?? []).map(String));

  // "Solo se muestran las razas de las especies elegidas": rebuilt when the species change.
  const breedSlot = h("div", {});
  let chosenBreeds = (current?.breedIds ?? []).map(String);
  const drawBreeds = (): void => {
    const wanted = [...species.querySelectorAll<HTMLInputElement>('input[name="speciesIds"]:checked')].map((i) => i.value);
    const visible = catalogue.species.filter((s) => wanted.length === 0 || wanted.includes(String(s.id)));
    const choices: Choice[] = visible.flatMap((s) => s.breeds.map((b): Choice => [String(b.id), b.name]));
    chosenBreeds = chosenBreeds.filter((id) => choices.some(([value]) => value === id));
    const group = chipGroup("breedIds", choices, chosenBreeds);
    group.addEventListener("change", () => {
      chosenBreeds = [...group.querySelectorAll<HTMLInputElement>('input[name="breedIds"]:checked')].map((i) => i.value);
    });
    breedSlot.replaceChildren(group);
  };
  species.addEventListener("change", drawBreeds);
  drawBreeds();

  const result = h("div", {});
  const submit = h("button", { type: "submit", class: "button button--primary" }, "Guardar preferencias");
  const form = h(
    "form",
    { class: "preferences", novalidate: true },
    h("p", { class: "muted" }, "Todas las preguntas son opcionales y admiten varias respuestas."),
    question("Especie", null, species),
    question("Raza", "Solo se muestran las razas de las especies elegidas.", breedSlot),
    question("Tamaño", null, chipGroup("sizes", SIZES, current?.sizes ?? [])),
    question("Sexo", null, chipGroup("sexes", SEXES, current?.sexes ?? [])),
    question(
      "Edad",
      "Indica una edad mínima, una máxima, las dos o ninguna.",
      h("div", { class: "age-range" }, ageSelect("minAgeMonths", "Mínima", current?.minAgeMonths ?? null), ageSelect("maxAgeMonths", "Máxima", current?.maxAgeMonths ?? null)),
    ),
    question("Nivel de actividad", null, chipGroup("activityLevels", ACTIVITY, current?.activityLevels ?? [])),
    question(
      "Convivencia con niños",
      null,
      h(
        "label",
        { class: "checkbox" },
        h("input", { type: "checkbox", name: "needsGoodWithChildren", checked: current?.needsGoodWithChildren ?? false }),
        " Necesito que se lleve bien con niños",
      ),
    ),
    question(
      "Convivencia con otros animales",
      "Marca las especies con las que tiene que llevarse bien. Si marcas varias, con todas.",
      chipGroup("mustGetAlongWithSpeciesIds", speciesChoices, (current?.mustGetAlongWithSpeciesIds ?? []).map(String)),
    ),
    result,
    h("p", { class: "muted" }, "Al guardar, las mascotas que descartaste en el modo descubrir pueden volver a aparecer. Tus favoritas se conservan."),
    submit,
  );

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit.disabled = true;
    savePreferences(readForm(form))
      .then(
        () => result.replaceChildren(notice("success", "Preferencias guardadas")),
        (error: unknown) => result.replaceChildren(notice("error", error instanceof ApiError ? error.message : "No se han podido guardar las preferencias.")),
      )
      .finally(() => (submit.disabled = false));
  });
  return form;
}

/** Only adopters: anyone else is sent away. */
async function adopterOnly(): Promise<SessionUser | null> {
  const user = await currentUser();
  if (!user) navigate("/iniciar-sesion", { replace: true });
  else if (user.role !== "ADOPTER") navigate("/inicio", { replace: true });
  return user?.role === "ADOPTER" ? user : null;
}

/** CU-08 · /perfil/preferencias: fill in or edit the questionnaire (RN-30, RN-31). */
export async function renderPreferences(root: HTMLElement): Promise<void> {
  const user = await adopterOnly();
  if (!user) return;

  let content: Node;
  try {
    const [catalogue, { preferences }] = await Promise.all([getBreeds(), getPreferences()]);
    content = preferencesForm(catalogue, preferences);
  } catch (error) {
    content = notice("error", error instanceof ApiError ? error.message : "No se han podido cargar tus preferencias.");
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("p", { class: "overline" }, "Mi perfil"),
      h("h1", { class: "display" }, "Preferencias"),
      h("p", { class: "muted" }, "Cuéntanos qué buscas para recomendarte mascotas en el modo descubrir."),
      content,
    ]),
  );
}
