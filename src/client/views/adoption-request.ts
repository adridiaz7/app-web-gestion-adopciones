import type { AdoptionRequest, Household } from "../../shared/api.js";
import { currentUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { getHousehold, requestAdoption } from "../api/adoptions.js";
import { getPetProfile } from "../api/pets.js";
import { appLayout } from "../components/app-layout.js";
import { boolChoice, numberField as numberInput, radios as radioGroup, YES_NO } from "../components/choice-fields.js";
import { onSubmit, submitButton, textValue } from "../components/form.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount } from "../dom.js";
import { navigate, type RouteParams } from "../router.js";

type Choice = [string, string];

/** The household questions answer to the API's `household.<field>` errors. */
const radios = (name: string, legend: string, choices: Choice[], value: string | null): HTMLElement =>
  radioGroup(name, legend, choices, value, `household.${name}`);

const numberField = (name: string, label: string, value: number | null, min: number, max: number): HTMLElement =>
  numberInput(name, label, value, min, max, `household.${name}`);

const bool = boolChoice;

/**
 * CU-27, RN-207 · /mascotas/:id/adoptar: first the household data of the profile, already
 * filled in, required (RN-117) and editable here (saved in the profile); then two optional
 * questions.
 */
export async function renderAdoptionRequest(root: HTMLElement, params: RouteParams): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }
  if (user.role !== "ADOPTER") {
    navigate("/inicio", { replace: true });
    return;
  }

  const petId = Number(params["id"]);
  let body: Node[];
  try {
    const [{ pet }, { household }] = await Promise.all([getPetProfile(petId), getHousehold()]);
    const h0: Household = household;
    const otherPets = h("textarea", { name: "otherPetsDescription", rows: "2", maxlength: "500" });
    otherPets.value = h0.otherPetsDescription ?? "";
    const reason = h("textarea", { name: "reason", rows: "4", maxlength: "2000" });

    const form = h(
      "form",
      { class: "form card adoption-form" },
      h("h2", {}, "Tu hogar"),
      h("p", { class: "muted" }, "Son los datos de tu perfil. Revísalos: si cambias algo, se guardará también en tu perfil."),
      radios("housingType", "Tipo de vivienda", [["APARTMENT", "Piso"], ["HOUSE", "Casa"], ["OTHER", "Otro"]], h0.housingType),
      radios("hasOutdoorSpace", "¿Tiene jardín o terraza?", YES_NO, bool(h0.hasOutdoorSpace)),
      radios("housingTenure", "La vivienda es", [["OWNED", "En propiedad"], ["RENTED", "De alquiler"], ["RENT_TO_OWN", "De alquiler con opción a compra"]], h0.housingTenure),
      numberField("householdMembers", "¿Cuántas personas viven en casa?", h0.householdMembers, 1, 50),
      radios("hasChildren", "¿Hay niños en casa?", YES_NO, bool(h0.hasChildren)),
      radios("hasOtherPets", "¿Hay otras mascotas?", YES_NO, bool(h0.hasOtherPets)),
      h("div", { class: "field", "data-field": "household.otherPetsDescription" }, h("label", {}, "Si las hay, cuéntanos cuáles (opcional)", otherPets), h("p", { class: "field__error" })),
      radios("hasPetExperience", "¿Has tenido mascotas antes?", YES_NO, bool(h0.hasPetExperience)),
      numberField("hoursAlonePerDay", `¿Cuántas horas al día pasaría ${pet.name} sola?`, h0.hoursAlonePerDay, 0, 24),
      h("h2", {}, "Unas preguntas (opcionales)"),
      h("div", { class: "field", "data-field": "answers.reason" }, h("label", {}, `¿Por qué te gustaría adoptar a ${pet.name}?`, reason), h("p", { class: "field__error" })),
      radios("canAffordCosts", "¿Podrás hacerte cargo de sus gastos (vacunas, seguro, veterinario, comida…)?", YES_NO, null),
      submitButton("Enviar solicitud"),
    );

    onSubmit(form, async () => {
      const value = (name: string) => textValue(form, name);
      const boolOf = (name: string): boolean => value(name) === "true";
      const numberOf = (name: string): number => (value(name) === "" ? Number.NaN : Number(value(name)));
      const answers: AdoptionRequest["answers"] = {};
      if (value("reason").trim()) answers.reason = value("reason");
      if (value("canAffordCosts")) answers.canAffordCosts = boolOf("canAffordCosts");
      // Unanswered fields go out empty so the server lists them as missing (RN-117).
      const household = {
        housingType: value("housingType") || undefined,
        hasOutdoorSpace: value("hasOutdoorSpace") ? boolOf("hasOutdoorSpace") : undefined,
        housingTenure: value("housingTenure") || undefined,
        householdMembers: Number.isNaN(numberOf("householdMembers")) ? undefined : numberOf("householdMembers"),
        hasChildren: value("hasChildren") ? boolOf("hasChildren") : undefined,
        hasOtherPets: value("hasOtherPets") ? boolOf("hasOtherPets") : undefined,
        otherPetsDescription: value("otherPetsDescription") || null,
        hasPetExperience: value("hasPetExperience") ? boolOf("hasPetExperience") : undefined,
        hoursAlonePerDay: Number.isNaN(numberOf("hoursAlonePerDay")) ? undefined : numberOf("hoursAlonePerDay"),
      } as AdoptionRequest["household"];
      await requestAdoption({ petId, household, answers });
      mount(
        root,
        appLayout(user, navFor(user.role), [
          h("h1", { class: "display" }, "Solicitud enviada"),
          notice("success", `Has solicitado adoptar a ${pet.name}.`, "La protectora revisará tu solicitud junto a tus datos y respuestas. Te avisaremos cuando decida."),
          h("a", { class: "button button--secondary", href: `/mascotas/${String(petId)}` }, `Volver a la ficha de ${pet.name}`),
        ]),
      );
    });

    body = [h("p", { class: "muted" }, `${pet.name} · ${pet.shelter.name}`), form];
  } catch (error) {
    body = [notice("error", error instanceof ApiError ? error.message : "No se ha podido cargar el formulario.")];
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("a", { class: "back-link", href: `/mascotas/${String(petId)}` }, "← Volver a la ficha"),
      h("h1", { class: "display" }, "Solicitar la adopción"),
      ...body,
    ]),
  );
}
