import type { AdopterNote } from "../../shared/api.js";
import { ApiError } from "../api/client.js";
import { addNote, deleteNote, editNote, listNotes } from "../api/notes.js";
import { h } from "../dom.js";
import { onSubmit, submitButton, textValue } from "./form.js";
import { notice } from "./notice.js";

const WHEN = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function noteForm(initial: string, label: string, save: (text: string) => Promise<void>): HTMLFormElement {
  const area = h("textarea", { name: "body", rows: "3", maxlength: "5000", "aria-label": "Nota" });
  area.value = initial;
  const form = h("form", { class: "form" }, h("div", { class: "field", "data-field": "body" }, area, h("p", { class: "field__error" })), submitButton(label));
  onSubmit(form, () => save(textValue(form, "body")));
  return form;
}

/**
 * CU-52, RN-204 · private notes of the shelter about an adopter (the adopter never sees
 * them): list with dates, write, edit and delete.
 */
export function adopterNotesSection(adopterId: number): HTMLElement {
  const section = h("section", { class: "card form" }, h("h2", {}, "Notas internas"), h("p", { class: "muted" }, "Cargando…"));

  const render = (notes: AdopterNote[], message: HTMLElement | null = null): void => {
    const reload = (text: string | null = null): Promise<void> =>
      listNotes(adopterId).then(({ notes: fresh }) => {
        render(fresh, text ? notice("success", text) : null);
      });

    const items = notes.map((note) => {
      const item = h("li", { class: "note" });
      const show = (): void => {
        const editButton = h("button", { type: "button", class: "button button--secondary button--small" }, "Editar");
        const deleteButton = h("button", { type: "button", class: "button button--secondary button--small" }, "Borrar");
        editButton.addEventListener("click", () => {
          item.replaceChildren(noteForm(note.body, "Guardar", (text) => editNote(adopterId, note.id, text).then(() => reload("Nota guardada."))));
        });
        deleteButton.addEventListener("click", () => {
          if (!window.confirm("¿Borrar esta nota?")) return;
          deleteButton.disabled = true;
          deleteNote(adopterId, note.id)
            .then(() => reload("Nota borrada."))
            .catch((error: unknown) => {
              render(notes, notice("error", error instanceof ApiError ? error.message : "No se ha podido borrar la nota."));
            });
        });
        const edited = note.updatedAt !== note.createdAt ? ` · editada el ${WHEN.format(new Date(note.updatedAt))}` : "";
        item.replaceChildren(
          h("p", { class: "muted" }, `${WHEN.format(new Date(note.createdAt))}${edited}`),
          h("p", { class: "note__body" }, note.body),
          h("div", { class: "button-row" }, editButton, deleteButton),
        );
      };
      show();
      return item;
    });

    section.replaceChildren(
      h("h2", {}, "Notas internas"),
      h("p", { class: "muted" }, "Solo las ve tu protectora. El adoptante nunca las ve."),
      message ?? "",
      noteForm("", "Añadir nota", (text) => addNote(adopterId, text).then(() => reload("Nota añadida."))),
      notes.length === 0 ? h("p", { class: "muted" }, "Todavía no has escrito ninguna nota.") : h("ul", { class: "note-list" }, ...items),
    );
  };

  listNotes(adopterId)
    .then(({ notes }) => {
      render(notes);
    })
    .catch((error: unknown) => {
      section.replaceChildren(h("h2", {}, "Notas internas"), notice("error", error instanceof ApiError ? error.message : "No se han podido cargar las notas."));
    });
  return section;
}
