import { authPage } from "../components/auth-layout.js";
import { submitButton } from "../components/form.js";
import { h, mount } from "../dom.js";
import { navigate } from "../router.js";

function option(value: string, icon: string, title: string, text: string, isChecked: boolean): HTMLElement {
  return h(
    "label",
    { class: "choice" },
    h("span", { class: "choice__icon", "aria-hidden": "true" }, icon),
    h("span", { class: "choice__body" }, h("span", { class: "choice__title" }, title), h("span", { class: "choice__text" }, text)),
    h("input", { type: "radio", name: "accountType", value, checked: isChecked }),
  );
}

/** /registro: choose between an adopter and a shelter account (CU-01, CU-02). */
export function renderAccountType(root: HTMLElement): void {
  const form = h(
    "form",
    { class: "form" },
    h(
      "fieldset",
      { class: "choices" },
      h("legend", { class: "visually-hidden" }, "Tipo de cuenta"),
      option("adoptante", "♡", "Quiero adoptar", "Busca mascotas compatibles, visítalas y solicita su adopción.", true),
      option("protectora", "⌂", "Soy una protectora", "Publica tus mascotas y gestiona visitas y adopciones.", false),
    ),
    submitButton("Continuar →"),
  );

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const type = new FormData(form).get("accountType") === "protectora" ? "protectora" : "adoptante";
    navigate(`/registro/${type}`);
  });

  mount(
    root,
    authPage({
      overline: "Crear cuenta",
      title: "¿Cómo vas a usar la plataforma?",
      subtitle: "Elige el tipo de cuenta.",
      back: { href: "/", label: "Volver a la web" },
      content: [
        form,
        h("p", { class: "auth-card__alt" }, "¿Ya tienes cuenta? ", h("a", { class: "link", href: "/iniciar-sesion" }, "Iniciar sesión")),
      ],
    }),
  );
}
