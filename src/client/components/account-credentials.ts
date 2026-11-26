import { changeEmail, changePassword } from "../api/auth.js";
import { h } from "../dom.js";
import { field, onSubmit, submitButton, textValue } from "./form.js";
import { notice } from "./notice.js";

function showResult(form: HTMLFormElement, text: string): void {
  form.querySelector(".form-saved")?.remove();
  const saved = notice("success", text);
  saved.classList.add("form-saved");
  form.prepend(saved);
}

/** CU-49: change the password (with the current one) or the login email (confirmed by a link). */
export function credentialsSection(email: string): HTMLElement {
  const passwordForm = h(
    "form",
    { class: "form" },
    h("h3", {}, "Cambiar la contraseña"),
    field({ name: "currentPassword", label: "Contraseña actual", type: "password", autocomplete: "current-password" }),
    field({ name: "newPassword", label: "Contraseña nueva", type: "password", autocomplete: "new-password", hint: "Entre 12 y 256 caracteres." }),
    submitButton("Cambiar la contraseña"),
  );
  onSubmit(passwordForm, async () => {
    await changePassword({ currentPassword: textValue(passwordForm, "currentPassword"), newPassword: textValue(passwordForm, "newPassword") });
    passwordForm.reset();
    showResult(passwordForm, "Tu contraseña se ha cambiado.");
  });

  const emailForm = h(
    "form",
    { class: "form" },
    h("h3", {}, "Cambiar el email"),
    h("p", { class: "muted" }, `Ahora entras con ${email}. Te enviaremos un enlace al email nuevo para confirmarlo, y avisaremos del cambio a este.`),
    field({ name: "newEmail", label: "Email nuevo", type: "email", autocomplete: "email" }),
    submitButton("Enviar el enlace"),
  );
  onSubmit(emailForm, async () => {
    const { message } = await changeEmail({ newEmail: textValue(emailForm, "newEmail") });
    emailForm.reset();
    showResult(emailForm, message);
  });

  return h("section", { class: "card" }, h("h2", {}, "Acceso a tu cuenta"), passwordForm, emailForm);
}
