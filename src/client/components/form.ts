import { ApiError } from "../api/client.js";
import { h } from "../dom.js";
import { notice } from "./notice.js";

export interface FieldOptions {
  name: string;
  label: string;
  type?: string;
  autocomplete?: string;
  hint?: string;
  required?: boolean;
  value?: string;
  /** Extra element next to the label, like the "forgot your password?" link. */
  aside?: Node;
}

/** A labelled input with room for its error message (design system §8, form fields). */
export function field(options: FieldOptions): HTMLElement {
  const id = `field-${options.name}`;
  const input = h("input", {
    id,
    name: options.name,
    type: options.type ?? "text",
    autocomplete: options.autocomplete,
    required: options.required ?? true,
    value: options.value,
    "aria-describedby": `${id}-error`,
  });
  return h(
    "div",
    { class: "field", "data-field": options.name },
    h("div", { class: "field__label-row" }, h("label", { for: id }, options.label), options.aside ?? null),
    input,
    options.hint ? h("p", { class: "field__hint" }, options.hint) : null,
    h("p", { class: "field__error", id: `${id}-error` }),
  );
}

/** A labelled select. */
export function selectField(name: string, label: string, choices: { value: string; label: string }[]): HTMLElement {
  const id = `field-${name}`;
  return h(
    "div",
    { class: "field", "data-field": name },
    h("div", { class: "field__label-row" }, h("label", { for: id }, label)),
    h(
      "select",
      { id, name, required: true, "aria-describedby": `${id}-error` },
      h("option", { value: "" }, "Elige una opción"),
      ...choices.map((choice) => h("option", { value: choice.value }, choice.label)),
    ),
    h("p", { class: "field__error", id: `${id}-error` }),
  );
}

/** The required checkbox to accept the terms of use and the privacy policy (RN-186). */
export function termsCheckbox(): HTMLElement {
  return h(
    "div",
    { class: "field field--checkbox", "data-field": "acceptTerms" },
    h(
      "label",
      { class: "checkbox" },
      h("input", { type: "checkbox", name: "acceptTerms", "aria-describedby": "field-acceptTerms-error" }),
      h("span", {}, "He leído y acepto los términos de uso y la política de privacidad."),
    ),
    h("p", { class: "field__error", id: "field-acceptTerms-error" }),
  );
}

export function submitButton(label: string): HTMLButtonElement {
  return h("button", { type: "submit", class: "button button--primary button--block" }, label);
}

/** Text value of a form field, or "" when missing. */
export function textValue(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === "string" ? value : "";
}

/** Whether a checkbox of the form is ticked. */
export function checked(form: HTMLFormElement, name: string): boolean {
  return new FormData(form).has(name);
}

function clearErrors(form: HTMLFormElement): void {
  form.querySelector(".form-error")?.remove();
  for (const element of form.querySelectorAll(".field")) {
    element.classList.remove("field--invalid");
    const message = element.querySelector(".field__error");
    if (message) message.textContent = "";
  }
}

/** Shows the error of an API call: next to each invalid field, and as a message at the top of the form. */
function showError(form: HTMLFormElement, error: unknown): void {
  const apiError = error instanceof ApiError ? error : new ApiError(0, "Ha ocurrido un error inesperado.");
  for (const [name, message] of Object.entries(apiError.fields)) {
    const element = form.querySelector(`[data-field="${CSS.escape(name)}"]`);
    if (!element) continue;
    element.classList.add("field--invalid");
    const text = element.querySelector(".field__error");
    if (text) text.textContent = `✕ ${message}`;
  }
  const alert = notice("error", apiError.message);
  alert.classList.add("form-error");
  form.prepend(alert);
}

/**
 * Sends the form with `action` on submit: clears the previous errors, disables the button
 * while waiting, and shows the API errors in the form.
 */
export function onSubmit(form: HTMLFormElement, action: () => Promise<void>): void {
  form.noValidate = true; // The server validates and answers in Spanish, field by field.
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
    clearErrors(form);
    if (button) button.disabled = true;
    action()
      .catch((error: unknown) => {
        showError(form, error);
      })
      .finally(() => {
        if (button) button.disabled = false;
      });
  });
}
