import { deleteAccount } from "../api/auth.js";
import { h } from "../dom.js";
import { navigate } from "../router.js";
import { field, onSubmit, submitButton, textValue } from "./form.js";

/** What deleting the account means for each role (CU-07, RN-11 to RN-13). */
const CONSEQUENCES: Record<"ADOPTER" | "SHELTER", string> = {
  ADOPTER:
    "Se borrarán tus datos personales y los de tu hogar. Tus visitas y solicitudes de adopción abiertas se anularán. Tus conversaciones se conservarán con tu nombre como «Usuario eliminado». No se puede deshacer.",
  SHELTER:
    "Se borrarán los datos de tu protectora. Tus mascotas disponibles y reservadas se darán de baja, y las visitas y solicitudes abiertas se anularán con aviso a los adoptantes. Tus conversaciones se conservarán como «Usuario eliminado». No se puede deshacer.",
};

/** CU-07: a section at the end of the profile; the deletion is confirmed with the current password. */
export function deleteAccountSection(role: "ADOPTER" | "SHELTER"): HTMLElement {
  const form = h(
    "form",
    { class: "form", hidden: true },
    field({ name: "password", label: "Escribe tu contraseña para confirmar", type: "password", autocomplete: "current-password" }),
  );
  const cancel = h("button", { type: "button", class: "button button--secondary" }, "Cancelar");
  const confirm = submitButton("Sí, eliminar mi cuenta");
  confirm.classList.remove("button--primary", "button--block");
  confirm.classList.add("button--danger");
  form.append(h("div", { class: "dialog__actions" }, cancel, confirm));

  const open = h("button", { type: "button", class: "button button--danger" }, "Eliminar mi cuenta");
  open.addEventListener("click", () => {
    open.hidden = true;
    form.hidden = false;
    form.querySelector("input")?.focus();
  });
  cancel.addEventListener("click", () => {
    form.reset();
    form.hidden = true;
    open.hidden = false;
  });
  onSubmit(form, async () => {
    await deleteAccount({ password: textValue(form, "password") });
    navigate("/", { replace: true });
  });

  return h("section", { class: "card danger-zone" }, h("h2", {}, "Eliminar mi cuenta"), h("p", { class: "muted" }, CONSEQUENCES[role]), open, form);
}
