import { deleteAccountSection } from "../components/delete-account.js";
import type { AdopterProfile, AdopterProfileUpdate, Household, ShelterProfile } from "../../shared/api.js";
import { currentUser, getProvinces, type SessionUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { deleteShelterLogo, getAdopterProfile, getShelterProfile, saveAdopterProfile, saveShelterProfile, uploadShelterLogo } from "../api/profile.js";
import { appLayout } from "../components/app-layout.js";
import { boolChoice, HOUSING_TENURES, HOUSING_TYPES, numberField, radios, YES_NO } from "../components/choice-fields.js";
import { field, onSubmit, selectField, submitButton, textValue } from "../components/form.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { rememberProfileName } from "../components/profile-card.js";
import { h, mount } from "../dom.js";
import { navigate } from "../router.js";

async function provinceSelect(value: number): Promise<HTMLElement> {
  const { provinces } = await getProvinces();
  const element = selectField(
    "provinceId",
    "Provincia",
    provinces.map((p) => ({ value: String(p.id), label: p.name })),
  );
  const select = element.querySelector("select");
  if (select) select.value = String(value);
  return element;
}

function textArea(name: string, label: string, value: string | null, maxLength: number): HTMLElement {
  const area = h("textarea", { id: `field-${name}`, name, rows: "4", maxlength: String(maxLength), "aria-describedby": `field-${name}-error` });
  area.value = value ?? "";
  return h("div", { class: "field", "data-field": name }, h("label", { for: `field-${name}` }, label), area, h("p", { class: "field__error", id: `field-${name}-error` }));
}

/** A success notice at the top of the form, replacing the previous one. */
function showSaved(form: HTMLFormElement, text: string): void {
  form.querySelector(".form-saved")?.remove();
  const saved = notice("success", text);
  saved.classList.add("form-saved");
  form.prepend(saved);
}

const nullableBool = (value: string): boolean | null => (value === "" ? null : value === "true");
const nullableNumber = (value: string): number | null => (value.trim() === "" ? null : Number(value));

/** CU-06, RN-25, RN-27 · the adopter's personal data and household data (optional here). */
async function adopterForm(user: SessionUser, profile: AdopterProfile): Promise<Node[]> {
  const hh: Household = profile.household;
  const otherPets = textArea("otherPetsDescription", "Si las hay, cuéntanos cuáles (opcional)", hh.otherPetsDescription, 500);
  otherPets.dataset["field"] = "household.otherPetsDescription";
  const key = (name: string) => `household.${name}`;

  const form = h(
    "form",
    { class: "form card" },
    h("h2", {}, "Datos personales"),
    h("p", { class: "muted" }, `Email de acceso: ${profile.email}`),
    field({ name: "firstName", label: "Nombre", autocomplete: "given-name", value: profile.firstName }),
    field({ name: "lastName", label: "Apellidos", autocomplete: "family-name", value: profile.lastName }),
    field({ name: "phone", label: "Teléfono", type: "tel", autocomplete: "tel", value: profile.phone }),
    field({ name: "birthDate", label: "Fecha de nacimiento", type: "date", autocomplete: "bday", value: profile.birthDate }),
    await provinceSelect(profile.provinceId),
    field({ name: "locality", label: "Localidad", value: profile.locality }),
    h("h2", {}, "Mi hogar"),
    h("p", { class: "muted" }, "Estos datos son opcionales ahora, pero los necesitarás para solicitar una adopción."),
    radios("housingType", "Tipo de vivienda", HOUSING_TYPES, hh.housingType, key("housingType")),
    radios("hasOutdoorSpace", "¿Tiene jardín o terraza?", YES_NO, boolChoice(hh.hasOutdoorSpace), key("hasOutdoorSpace")),
    radios("housingTenure", "La vivienda es", HOUSING_TENURES, hh.housingTenure, key("housingTenure")),
    numberField("householdMembers", "¿Cuántas personas viven en casa?", hh.householdMembers, 1, 50, key("householdMembers")),
    radios("hasChildren", "¿Hay niños en casa?", YES_NO, boolChoice(hh.hasChildren), key("hasChildren")),
    radios("hasOtherPets", "¿Hay otras mascotas?", YES_NO, boolChoice(hh.hasOtherPets), key("hasOtherPets")),
    otherPets,
    radios("hasPetExperience", "¿Has tenido mascotas antes?", YES_NO, boolChoice(hh.hasPetExperience), key("hasPetExperience")),
    numberField("hoursAlonePerDay", "¿Cuántas horas al día pasaría sola la mascota?", hh.hoursAlonePerDay, 0, 24, key("hoursAlonePerDay")),
    submitButton("Guardar cambios"),
  );

  onSubmit(form, async () => {
    const value = (name: string) => textValue(form, name);
    const housingType = value("housingType");
    const housingTenure = value("housingTenure");
    const body: AdopterProfileUpdate = {
      firstName: value("firstName"),
      lastName: value("lastName"),
      phone: value("phone"),
      birthDate: value("birthDate"),
      provinceId: Number(value("provinceId")) || 0,
      locality: value("locality"),
      household: {
        housingType: housingType === "APARTMENT" || housingType === "HOUSE" || housingType === "OTHER" ? housingType : null,
        hasOutdoorSpace: nullableBool(value("hasOutdoorSpace")),
        housingTenure: housingTenure === "OWNED" || housingTenure === "RENTED" || housingTenure === "RENT_TO_OWN" ? housingTenure : null,
        householdMembers: nullableNumber(value("householdMembers")),
        hasChildren: nullableBool(value("hasChildren")),
        hasOtherPets: nullableBool(value("hasOtherPets")),
        otherPetsDescription: value("otherPetsDescription") || null,
        hasPetExperience: nullableBool(value("hasPetExperience")),
        hoursAlonePerDay: nullableNumber(value("hoursAlonePerDay")),
      },
    };
    const { profile: saved } = await saveAdopterProfile(body);
    rememberProfileName(user.id, saved.firstName);
    showSaved(form, "Tus datos se han guardado.");
  });

  return [form];
}

/** CU-06, RN-52 · the shelter's logo: upload a new one or remove it. */
function logoSection(initial: ShelterProfile): HTMLElement {
  const section = h("section", { class: "card form" });
  const render = (profile: ShelterProfile, message: HTMLElement | null = null): void => {
    const input = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", id: "field-logo" });
    const remove = h("button", { type: "button", class: "button button--secondary button--small" }, "Quitar el logo");
    const run = (action: () => Promise<{ profile: ShelterProfile }>, done: string): void => {
      input.disabled = true;
      remove.disabled = true;
      action()
        .then((res) => {
          render(res.profile, notice("success", done));
        })
        .catch((error: unknown) => {
          render(profile, notice("error", error instanceof ApiError ? error.message : "No se ha podido cambiar el logo."));
        });
    };
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) run(() => uploadShelterLogo(file), "El logo se ha actualizado.");
    });
    remove.addEventListener("click", () => {
      run(deleteShelterLogo, "Se ha quitado el logo.");
    });
    section.replaceChildren(
      h("h2", {}, "Logo"),
      message ?? "",
      profile.logoUrl ? h("img", { class: "profile-logo", src: profile.logoUrl, alt: `Logo de ${profile.name}` }) : h("p", { class: "muted" }, "Todavía no has subido un logo."),
      h("div", { class: "field" }, h("label", { for: "field-logo" }, profile.logoUrl ? "Cambiar el logo (JPEG, PNG o WebP)" : "Subir un logo (JPEG, PNG o WebP)"), input),
      profile.logoUrl ? remove : "",
    );
  };
  render(initial);
  return section;
}

/** CU-06 · the shelter's public data. The name and the CIF are shown but not edited. */
async function shelterForm(profile: ShelterProfile): Promise<Node[]> {
  const form = h(
    "form",
    { class: "form card" },
    h("h2", {}, "Datos públicos"),
    h("p", { class: "muted" }, `${profile.name} · CIF ${profile.cif} · Email de acceso: ${profile.email}`),
    textArea("description", "Descripción (opcional)", profile.description, 2000),
    field({ name: "address", label: "Dirección", autocomplete: "street-address", value: profile.address }),
    await provinceSelect(profile.provinceId),
    field({ name: "locality", label: "Localidad", value: profile.locality }),
    field({ name: "phone", label: "Teléfono", type: "tel", autocomplete: "tel", value: profile.phone }),
    field({ name: "contactEmail", label: "Email de contacto (opcional)", type: "email", required: false, value: profile.contactEmail ?? "" }),
    field({ name: "website", label: "Web (opcional)", type: "url", required: false, hint: "Por ejemplo, https://miprotectora.org", value: profile.website ?? "" }),
    textArea("openingHours", "Horario (opcional)", profile.openingHours, 300),
    submitButton("Guardar cambios"),
  );

  onSubmit(form, async () => {
    const value = (name: string) => textValue(form, name);
    await saveShelterProfile({
      description: value("description") || null,
      address: value("address"),
      provinceId: Number(value("provinceId")) || 0,
      locality: value("locality"),
      phone: value("phone"),
      contactEmail: value("contactEmail") || null,
      website: value("website") || null,
      openingHours: value("openingHours") || null,
    });
    showSaved(form, "Los datos de la protectora se han guardado.");
  });

  return [logoSection(profile), form];
}

/** CU-06 · /perfil: the adopter's or the shelter's own profile. */
export async function renderProfile(root: HTMLElement): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }
  if (user.role === "ADMIN") {
    navigate("/inicio", { replace: true });
    return;
  }

  let body: Node[];
  try {
    body = user.role === "ADOPTER" ? await adopterForm(user, (await getAdopterProfile()).profile) : await shelterForm((await getShelterProfile()).profile);
  } catch (error) {
    body = [notice("error", error instanceof ApiError ? error.message : "No se ha podido cargar tu perfil.")];
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("h1", { class: "display" }, "Mi perfil"),
      user.role === "ADOPTER" ? h("p", { class: "muted" }, "Tus datos personales y los de tu hogar. ", h("a", { href: "/perfil/preferencias" }, "Editar mis preferencias")) : h("p", { class: "muted" }, "Los datos que ven los adoptantes en el perfil de tu protectora."),
      ...body,
      deleteAccountSection(user.role),
    ]),
  );
}
