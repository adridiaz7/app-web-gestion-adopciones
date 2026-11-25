import type { AdopterVisit, AvailableSlot, PetProfile } from "../../shared/api.js";
import { ApiError } from "../api/client.js";
import { getAvailableSlots, requestVisit, rescheduleVisit } from "../api/visits.js";
import { h } from "../dom.js";
import { madridDate, madridTime } from "../madrid-time.js";
import { notice } from "./notice.js";

const DAY = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long" });

const placesLabel = (n: number): string => (n === 1 ? "1 plaza libre" : `${String(n)} plazas libres`);
const errorText = (error: unknown, fallback: string): string => (error instanceof ApiError ? error.message : fallback);

/** The available slots (RN-194) grouped by day, as radio buttons. */
function slotChoices(slots: AvailableSlot[]): HTMLElement {
  const days = new Map<string, AvailableSlot[]>();
  for (const slot of slots) {
    const key = madridDate(slot.startsAt);
    days.set(key, [...(days.get(key) ?? []), slot]);
  }
  return h(
    "fieldset",
    { class: "visit-slots" },
    h("legend", { class: "overline" }, "Elige día y franja"),
    ...[...days.values()].map((daySlots) =>
      h(
        "div",
        { class: "visit-slots__day" },
        h("p", { class: "visit-slots__date" }, DAY.format(new Date(daySlots[0]?.startsAt ?? ""))),
        ...daySlots.map((slot) =>
          h(
            "label",
            { class: "visit-slot" },
            h("input", { type: "radio", name: "slot", value: String(slot.id), required: true }),
            h("strong", {}, `${madridTime(slot.startsAt)} – ${madridTime(slot.endsAt)}`),
            h("span", { class: "muted" }, placesLabel(slot.freePlaces)),
          ),
        ),
      ),
    ),
  );
}

/**
 * CU-23 · "Solicitar visita" on a pet's profile: a button that opens a dialog with the slots
 * available for that pet (RN-194) and sends the request.
 */
export function visitRequestButton(pet: PetProfile): HTMLElement {
  const open = h("button", { type: "button", class: "button button--primary" }, "Solicitar visita");
  const body = h("div", { class: "visit-request__body" });
  const close = h("button", { type: "button", class: "button button--secondary" }, "Cancelar");
  const dialog = h(
    "dialog",
    { class: "card dialog visit-request" },
    h("p", { class: "overline" }, "Solicitar visita"),
    h("h2", {}, pet.name),
    h("p", { class: "muted" }, pet.shelter.name),
    body,
  );
  close.addEventListener("click", () => dialog.close());

  const showSlots = (slots: AvailableSlot[]): void => {
    if (slots.length === 0) {
      body.replaceChildren(
        notice("info", "No hay franjas disponibles", "La protectora no tiene turnos libres con la antelación mínima. Vuelve a mirarlo más adelante."),
        h("div", { class: "dialog__actions" }, close),
      );
      return;
    }
    const message = h("div", {});
    const send = h("button", { type: "submit", class: "button button--primary" }, "Enviar solicitud");
    const form = h(
      "form",
      { class: "visit-request__form" },
      slotChoices(slots),
      notice("info", "Solo aparecen los turnos con la antelación mínima y plazas libres.", "La protectora tiene un plazo para responder; si no lo hace, la solicitud caduca."),
      message,
      h("div", { class: "dialog__actions" }, close, send),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const checked = form.querySelector<HTMLInputElement>('input[name="slot"]:checked');
      if (!checked) return;
      send.disabled = true;
      requestVisit({ petId: pet.id, slotId: Number(checked.value) }).then(
        ({ visit }) => {
          const done = h("button", { type: "button", class: "button button--primary" }, "Entendido");
          done.addEventListener("click", () => dialog.close());
          body.replaceChildren(
            notice(
              "success",
              "Solicitud enviada",
              `${DAY.format(new Date(visit.startsAt))}, de ${madridTime(visit.startsAt)} a ${madridTime(visit.endsAt)}, en ${visit.shelterAddress}. ` +
                "Te avisaremos cuando la protectora responda. Ya puedes escribirle por el chat.",
            ),
            h("div", { class: "dialog__actions" }, done),
          );
        },
        (error: unknown) => {
          send.disabled = false;
          message.replaceChildren(notice("error", errorText(error, "No se ha podido enviar la solicitud.")));
        },
      );
    });
    body.replaceChildren(form);
  };

  open.addEventListener("click", () => {
    body.replaceChildren(h("p", { class: "muted" }, "Cargando franjas…"));
    dialog.showModal();
    getAvailableSlots(pet.id).then(
      ({ slots }) => {
        showSlots(slots);
      },
      (error: unknown) => {
        body.replaceChildren(notice("error", errorText(error, "No se han podido cargar las franjas.")), h("div", { class: "dialog__actions" }, close));
      },
    );
  });

  return h("div", { class: "visit-request__trigger" }, open, dialog);
}

/**
 * CU-51 · "Reprogramar" on the adopter's visit list: a dialog with the slots available for the
 * same pet (RN-194). On success the original is cancelled and a new request awaits the shelter
 * (RN-196); if the new slot is not valid, the original visit is kept and the error is shown.
 */
export function openRescheduleDialog(visit: AdopterVisit, onDone: () => void): void {
  const body = h("div", { class: "visit-request__body" });
  const close = h("button", { type: "button", class: "button button--secondary" }, "Cancelar");
  const dialog = h(
    "dialog",
    { class: "card dialog visit-request" },
    h("p", { class: "overline" }, "Reprogramar visita"),
    h("h2", {}, visit.petName),
    h("p", { class: "muted" }, `${visit.shelterName} · ahora el ${DAY.format(new Date(visit.startsAt))} a las ${madridTime(visit.startsAt)}`),
    body,
  );
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());

  const showSlots = (slots: AvailableSlot[]): void => {
    if (slots.length === 0) {
      body.replaceChildren(
        notice("info", "No hay otras franjas disponibles", "La protectora no tiene otros turnos libres con la antelación mínima. Tu visita actual se mantiene."),
        h("div", { class: "dialog__actions" }, close),
      );
      return;
    }
    const message = h("div", {});
    const send = h("button", { type: "submit", class: "button button--primary" }, "Reprogramar");
    const form = h(
      "form",
      { class: "visit-request__form" },
      slotChoices(slots),
      notice("info", "Tu visita actual se cancelará y se enviará una solicitud nueva.", "La nueva visita queda pendiente de que la protectora la confirme."),
      message,
      h("div", { class: "dialog__actions" }, close, send),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const checked = form.querySelector<HTMLInputElement>('input[name="slot"]:checked');
      if (!checked) return;
      send.disabled = true;
      rescheduleVisit(visit.id, { slotId: Number(checked.value) }).then(
        () => {
          dialog.close();
          onDone();
        },
        (error: unknown) => {
          send.disabled = false;
          message.replaceChildren(notice("error", errorText(error, "No se ha podido reprogramar la visita. Tu visita actual se mantiene.")));
        },
      );
    });
    body.replaceChildren(form);
  };

  body.replaceChildren(h("p", { class: "muted" }, "Cargando franjas…"));
  document.body.append(dialog);
  dialog.showModal();
  getAvailableSlots(visit.petId).then(({ slots }) => {
    showSlots(slots);
  }, (error: unknown) => {
    body.replaceChildren(notice("error", errorText(error, "No se han podido cargar las franjas.")), h("div", { class: "dialog__actions" }, close));
  });
}
