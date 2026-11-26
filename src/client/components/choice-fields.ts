import { h } from "../dom.js";

export type Choice = [value: string, label: string];

export const YES_NO: Choice[] = [
  ["true", "Sí"],
  ["false", "No"],
];

/** A group of radio buttons with room for its error, `value` checked. `fieldKey` matches the API error. */
export function radios(name: string, legend: string, choices: Choice[], value: string | null, fieldKey = name): HTMLElement {
  return h(
    "fieldset",
    { class: "field radio-group", "data-field": fieldKey },
    h("legend", {}, legend),
    h(
      "div",
      { class: "radio-group__options" },
      ...choices.map(([optionValue, label]) =>
        h("label", { class: "checkbox" }, h("input", { type: "radio", name, value: optionValue, checked: optionValue === value }), label),
      ),
    ),
    h("p", { class: "field__error" }),
  );
}

/** A labelled number input with room for its error. */
export function numberField(name: string, label: string, value: number | null, min: number, max: number, fieldKey = name): HTMLElement {
  return h(
    "div",
    { class: "field", "data-field": fieldKey },
    h("label", { for: `field-${name}` }, label),
    h("input", { id: `field-${name}`, name, type: "number", min: String(min), max: String(max), value: value === null ? undefined : String(value) }),
    h("p", { class: "field__error" }),
  );
}

/** A boolean as the value of a Sí/No radio group. */
export const boolChoice = (value: boolean | null): string | null => (value === null ? null : String(value));

/** RN-27: the choices of the household questions. */
export const HOUSING_TYPES: Choice[] = [
  ["APARTMENT", "Piso"],
  ["HOUSE", "Casa"],
  ["OTHER", "Otro"],
];

export const HOUSING_TENURES: Choice[] = [
  ["OWNED", "En propiedad"],
  ["RENTED", "De alquiler"],
  ["RENT_TO_OWN", "De alquiler con opción a compra"],
];
