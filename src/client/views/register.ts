import { getProvinces, registerAdopter, registerShelter } from "../api/auth.js";
import { authPage } from "../components/auth-layout.js";
import { checked, field, onSubmit, selectField, submitButton, termsCheckbox, textValue } from "../components/form.js";
import { notice } from "../components/notice.js";
import { h, mount } from "../dom.js";
import { navigate } from "../router.js";
import { setPendingEmail } from "./check-email.js";

const PASSWORD_HINT = "Entre 12 y 256 caracteres. Puedes usar una frase fácil de recordar.";

async function provinceField(): Promise<HTMLElement> {
  try {
    const { provinces } = await getProvinces();
    return selectField(
      "provinceId",
      "Provincia",
      provinces.map((p) => ({ value: String(p.id), label: p.name })),
    );
  } catch {
    return notice("error", "No se han podido cargar las provincias.", "Recarga la página para intentarlo de nuevo.");
  }
}

const provinceId = (form: HTMLFormElement): number => Number(textValue(form, "provinceId")) || 0;

function registerPage(overline: string, form: HTMLFormElement): HTMLElement {
  return authPage({
    overline,
    title: "Crea tu cuenta",
    subtitle: "Te enviaremos un email para verificarla.",
    back: { href: "/registro", label: "Cambiar tipo de cuenta" },
    content: [
      form,
      h("p", { class: "auth-card__alt" }, "¿Ya tienes cuenta? ", h("a", { class: "link", href: "/iniciar-sesion" }, "Iniciar sesión")),
    ],
  });
}

/** CU-01 · /registro/adoptante */
export async function renderRegisterAdopter(root: HTMLElement): Promise<void> {
  const form = h(
    "form",
    { class: "form" },
    field({ name: "email", label: "Email", type: "email", autocomplete: "email", hint: "Te enviaremos un enlace para verificarlo." }),
    field({ name: "password", label: "Contraseña", type: "password", autocomplete: "new-password", hint: PASSWORD_HINT }),
    h(
      "div",
      { class: "form__row" },
      field({ name: "firstName", label: "Nombre", autocomplete: "given-name" }),
      field({ name: "lastName", label: "Apellidos", autocomplete: "family-name" }),
    ),
    h(
      "div",
      { class: "form__row" },
      field({ name: "phone", label: "Teléfono", type: "tel", autocomplete: "tel" }),
      field({ name: "birthDate", label: "Fecha de nacimiento", type: "date", autocomplete: "bday" }),
    ),
    h(
      "div",
      { class: "form__row" },
      await provinceField(),
      field({ name: "locality", label: "Localidad", autocomplete: "address-level2" }),
    ),
    termsCheckbox(),
    submitButton("Crear cuenta →"),
  );

  onSubmit(form, async () => {
    const email = textValue(form, "email");
    await registerAdopter({
      email,
      password: textValue(form, "password"),
      firstName: textValue(form, "firstName"),
      lastName: textValue(form, "lastName"),
      phone: textValue(form, "phone"),
      birthDate: textValue(form, "birthDate"),
      provinceId: provinceId(form),
      locality: textValue(form, "locality"),
      acceptTerms: checked(form, "acceptTerms"),
    });
    setPendingEmail(email);
    navigate("/revisa-tu-email");
  });

  mount(root, registerPage("Cuenta de adoptante", form));
}

/** CU-02 · /registro/protectora */
export async function renderRegisterShelter(root: HTMLElement): Promise<void> {
  const form = h(
    "form",
    { class: "form" },
    notice("info", "Tu cuenta quedará pendiente de validación", "El equipo de la plataforma comprobará tu CIF antes de que puedas publicar mascotas."),
    field({ name: "email", label: "Email de la cuenta", type: "email", autocomplete: "email" }),
    field({ name: "password", label: "Contraseña", type: "password", autocomplete: "new-password", hint: PASSWORD_HINT }),
    field({ name: "name", label: "Nombre de la protectora", autocomplete: "organization" }),
    h(
      "div",
      { class: "form__row" },
      field({ name: "cif", label: "CIF", hint: "Por ejemplo, G12345678." }),
      field({ name: "phone", label: "Teléfono", type: "tel", autocomplete: "tel" }),
    ),
    field({ name: "address", label: "Dirección", autocomplete: "street-address", hint: "Aquí se harán las visitas." }),
    h(
      "div",
      { class: "form__row" },
      await provinceField(),
      field({ name: "locality", label: "Localidad", autocomplete: "address-level2" }),
    ),
    termsCheckbox(),
    submitButton("Crear cuenta →"),
  );

  onSubmit(form, async () => {
    const email = textValue(form, "email");
    await registerShelter({
      email,
      password: textValue(form, "password"),
      name: textValue(form, "name"),
      cif: textValue(form, "cif"),
      address: textValue(form, "address"),
      provinceId: provinceId(form),
      locality: textValue(form, "locality"),
      phone: textValue(form, "phone"),
      acceptTerms: checked(form, "acceptTerms"),
    });
    setPendingEmail(email);
    navigate("/revisa-tu-email");
  });

  mount(root, registerPage("Cuenta de protectora", form));
}
