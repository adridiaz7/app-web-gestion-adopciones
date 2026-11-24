import { resendVerification } from "../api/auth.js";
import { authPage } from "../components/auth-layout.js";
import { field, onSubmit, textValue } from "../components/form.js";
import { notice } from "../components/notice.js";
import { h, mount } from "../dom.js";

/** Email just used to sign up, kept in memory only (not in the address, as it is personal data). */
let pendingEmail = "";

export function setPendingEmail(email: string): void {
  pendingEmail = email.trim();
}

/** /revisa-tu-email: after signing up, and to ask for a new verification link (CU-03, RN-180). */
export function renderCheckEmail(root: HTMLElement): void {
  const resendForm = h(
    "form",
    { class: "form" },
    field({ name: "email", label: "Email de tu cuenta", type: "email", autocomplete: "email", value: pendingEmail }),
    h(
      "div",
      { class: "form__actions" },
      h("button", { type: "submit", class: "button button--secondary" }, "Reenviar enlace"),
      h("a", { class: "button button--primary", href: "/iniciar-sesion" }, "Ir a iniciar sesión"),
    ),
  );

  onSubmit(resendForm, async () => {
    const { message } = await resendVerification({ email: textValue(resendForm, "email") });
    resendForm.querySelector(".form-result")?.remove();
    const result = notice("success", "Enlace enviado", message);
    result.classList.add("form-result");
    resendForm.append(result);
  });

  mount(
    root,
    authPage({
      overline: "Último paso",
      title: "Revisa tu email",
      subtitle: pendingEmail ? `Hemos enviado un enlace de verificación a ${pendingEmail}.` : "Te hemos enviado un enlace de verificación.",
      icon: "✉",
      back: { href: "/", label: "Volver a la web" },
      content: [
        h(
          "ol",
          { class: "steps" },
          h("li", {}, "Abre el email que te hemos enviado."),
          h("li", {}, "Pulsa el enlace para activar tu cuenta."),
          h("li", {}, "Inicia sesión."),
        ),
        notice("info", "¿No lo encuentras?", "Revisa la carpeta de spam. Si el enlace ha caducado, pide uno nuevo."),
        resendForm,
      ],
    }),
  );
}
