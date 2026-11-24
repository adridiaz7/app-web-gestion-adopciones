import { forgotPassword, resetPassword } from "../api/auth.js";
import { authPage } from "../components/auth-layout.js";
import { field, onSubmit, submitButton, textValue } from "../components/form.js";
import { notice } from "../components/notice.js";
import { h, mount, queryParam } from "../dom.js";

const loginAlt = (text: string) =>
  h("p", { class: "auth-card__alt" }, text, h("a", { class: "link", href: "/iniciar-sesion" }, "Iniciar sesión"));

/** CU-05 · /recuperar-contrasena: ask for a reset link. */
export function renderForgotPassword(root: HTMLElement): void {
  const form = h(
    "form",
    { class: "form" },
    field({ name: "email", label: "Email", type: "email", autocomplete: "email" }),
    submitButton("Enviar enlace"),
  );

  onSubmit(form, async () => {
    const { message } = await forgotPassword({ email: textValue(form, "email") });
    form.querySelector(".form-result")?.remove();
    const result = notice("success", "Enlace enviado", message);
    result.classList.add("form-result");
    form.append(result);
  });

  mount(
    root,
    authPage({
      overline: "Recuperar contraseña",
      title: "¿Has olvidado tu contraseña?",
      subtitle: "Escribe el email de tu cuenta y te enviaremos un enlace para crear una nueva.",
      icon: "🔑",
      back: { href: "/iniciar-sesion", label: "Volver a iniciar sesión" },
      content: [form, loginAlt("¿Te has acordado? ")],
    }),
  );
}

/** CU-05 · /restablecer-contrasena?token=… (the link of the email): choose the new password. */
export function renderResetPassword(root: HTMLElement): void {
  const form = h(
    "form",
    { class: "form" },
    field({
      name: "password",
      label: "Contraseña nueva",
      type: "password",
      autocomplete: "new-password",
      hint: "Entre 12 y 256 caracteres. Puedes usar una frase fácil de recordar.",
    }),
    submitButton("Guardar contraseña"),
  );

  onSubmit(form, async () => {
    const { message } = await resetPassword({ token: queryParam("token"), password: textValue(form, "password") });
    form.replaceChildren(
      notice("success", "Contraseña cambiada", message),
      h("a", { class: "button button--primary button--block", href: "/iniciar-sesion" }, "Ir a iniciar sesión"),
    );
  });

  mount(
    root,
    authPage({
      overline: "Recuperar contraseña",
      title: "Elige una contraseña nueva",
      icon: "🔑",
      back: { href: "/iniciar-sesion", label: "Volver a iniciar sesión" },
      content: [form, h("p", { class: "auth-card__alt" }, "¿El enlace ha caducado? ", h("a", { class: "link", href: "/recuperar-contrasena" }, "Pide uno nuevo"))],
    }),
  );
}
