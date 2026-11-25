import type { ShelterSlot, SlotRequest } from "../../shared/api.js";
import { currentUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { createRecurringSlots, createSlot, deleteSlot, listSlots, updateSlot } from "../api/slots.js";
import { appLayout } from "../components/app-layout.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount } from "../dom.js";
import { madridDate, madridTime, madridToIso } from "../madrid-time.js";
import { navigate } from "../router.js";

const VISIT_STATUS: Record<string, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  REJECTED: "Rechazada",
  CANCELLED: "Cancelada",
  EXPIRED: "Caducada",
  VOIDED: "Anulada",
  COMPLETED: "Realizada",
  NO_SHOW: "No asistió",
};

/** CU-50: ISO order, Monday (1) to Sunday (7). */
const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const DAY = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** The fields of a slot (RN-78): day, start, end and places, in Madrid time. */
function slotFields(slot: ShelterSlot | null): HTMLElement {
  const input = (name: string, label: string, type: string, value: string, extra: Record<string, string> = {}) =>
    h("label", { class: "slot-form__field" }, h("span", {}, label), h("input", { name, type, value, required: true, ...extra }));
  return h(
    "div",
    { class: "slot-form__fields" },
    input("date", "Día", "date", slot ? madridDate(slot.startsAt) : ""),
    input("start", "Inicio", "time", slot ? madridTime(slot.startsAt) : ""),
    input("end", "Fin", "time", slot ? madridTime(slot.endsAt) : ""),
    input("capacity", "Plazas", "number", slot ? String(slot.capacity) : "1", { min: "1", step: "1" }),
  );
}

function readSlot(form: HTMLFormElement): SlotRequest {
  const value = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? "";
  return {
    startsAt: madridToIso(value("date"), value("start")),
    endsAt: madridToIso(value("date"), value("end")),
    capacity: Number(value("capacity")),
  };
}

function calendar(initial: ShelterSlot[]): HTMLElement {
  let slots = initial;
  const root = h("div", {});
  const message = h("div", {});
  const fail = (error: unknown): void =>
    message.replaceChildren(notice("error", error instanceof ApiError ? error.message : "No se ha podido guardar el turno."));
  const sortSlots = (list: ShelterSlot[]) => [...list].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const slotCard = (slot: ShelterSlot): HTMLElement => {
    const card = h("article", { class: "card slot-card" });
    const showView = (): void => {
      const edit = h("button", { type: "button", class: "button button--secondary button--small" }, "Modificar");
      const remove = h("button", { type: "button", class: "button button--secondary button--small" }, "Eliminar");
      const started = new Date(slot.startsAt).getTime() <= Date.now();
      edit.disabled = started;
      remove.disabled = started;
      edit.addEventListener("click", showEdit);
      remove.addEventListener("click", () => {
        const warning = slot.occupied > 0 ? " Sus visitas se anularán y se avisará a los adoptantes." : "";
        if (!window.confirm(`¿Eliminar este turno?${warning}`)) return;
        deleteSlot(slot.id).then(() => {
          slots = slots.filter((s) => s.id !== slot.id);
          message.replaceChildren(notice("success", "Turno eliminado"));
          draw();
        }, fail);
      });
      card.replaceChildren(
        h(
          "div",
          { class: "slot-card__head" },
          h("strong", {}, `${madridTime(slot.startsAt)} – ${madridTime(slot.endsAt)}`),
          h("span", { class: "muted" }, `${String(slot.occupied)} de ${String(slot.capacity)} plazas ocupadas · ${String(slot.capacity - slot.occupied)} libres`),
          h("span", { class: "slot-card__actions" }, edit, remove),
        ),
        slot.visits.length === 0
          ? h("p", { class: "muted" }, "Sin visitas.")
          : h(
              "ul",
              { class: "slot-card__visits" },
              ...slot.visits.map((v) => h("li", {}, `${v.petName} · ${v.adopterName} · ${VISIT_STATUS[v.status] ?? v.status}`)),
            ),
      );
    };
    const showEdit = (): void => {
      const cancel = h("button", { type: "button", class: "button button--secondary button--small" }, "Cancelar");
      const form = h(
        "form",
        { class: "slot-form" },
        slotFields(slot),
        h("p", { class: "muted" }, "Si cambias el día o el horario, sus visitas se anularán y se invitará a los adoptantes a elegir otro turno."),
        h("div", { class: "slot-card__actions" }, cancel, h("button", { type: "submit", class: "button button--primary button--small" }, "Guardar")),
      );
      cancel.addEventListener("click", showView);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        updateSlot(slot.id, readSlot(form)).then((res) => {
          slots = slots.map((s) => (s.id === slot.id ? res.slot : s));
          message.replaceChildren(notice("success", "Turno modificado"));
          draw();
        }, fail);
      });
      card.replaceChildren(form);
    };
    showView();
    return card;
  };

  const createForm = h(
    "form",
    { class: "card slot-form" },
    h("h2", {}, "Nuevo turno"),
    slotFields(null),
    h("button", { type: "submit", class: "button button--primary" }, "Crear turno"),
  );
  createForm.addEventListener("submit", (event) => {
    event.preventDefault();
    createSlot(readSlot(createForm)).then((res) => {
      slots = [...slots, res.slot];
      message.replaceChildren(notice("success", "Turno creado"));
      draw();
    }, fail);
  });

  const recurringForm = h(
    "form",
    { class: "slot-form" },
    h(
      "div",
      { class: "slot-form__fields" },
      h("label", { class: "slot-form__field" }, h("span", {}, "Desde"), h("input", { name: "startDate", type: "date", required: true })),
      h("label", { class: "slot-form__field" }, h("span", {}, "Hasta"), h("input", { name: "endDate", type: "date", required: true })),
      h("label", { class: "slot-form__field" }, h("span", {}, "Inicio"), h("input", { name: "start", type: "time", required: true })),
      h("label", { class: "slot-form__field" }, h("span", {}, "Fin"), h("input", { name: "end", type: "time", required: true })),
      h(
        "label",
        { class: "slot-form__field" },
        h("span", {}, "Plazas"),
        h("input", { name: "capacity", type: "number", value: "1", min: "1", step: "1", required: true }),
      ),
    ),
    h(
      "fieldset",
      { class: "slot-form__weekdays" },
      h("legend", {}, "Días de la semana"),
      ...WEEKDAYS.map((label, index) =>
        h("label", { class: "checkbox" }, h("input", { type: "checkbox", name: "weekday", value: String(index + 1) }), ` ${label}`),
      ),
    ),
    h("p", { class: "muted" }, "Se crea un turno independiente por cada día, como máximo para 3 meses. Los días que choquen con un turno que ya tienes no se crean."),
    h("button", { type: "submit", class: "button button--primary" }, "Crear turnos"),
  );
  recurringForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = (name: string) => recurringForm.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? "";
    const weekdays = [...recurringForm.querySelectorAll<HTMLInputElement>('input[name="weekday"]:checked')].map((input) => Number(input.value));
    createRecurringSlots({
      startDate: value("startDate"),
      endDate: value("endDate"),
      weekdays,
      startTime: value("start"),
      endTime: value("end"),
      capacity: Number(value("capacity")),
    }).then((res) => {
      slots = [...slots, ...res.slots];
      const created = res.slots.length === 1 ? "Se ha creado 1 turno" : `Se han creado ${String(res.slots.length)} turnos`;
      message.replaceChildren(
        res.skipped.length === 0
          ? notice("success", created)
          : notice(
              "warning",
              created,
              `No se han creado estos, porque chocan con turnos que ya tienes: ${res.skipped
                .map((slot) => `${DAY.format(new Date(slot.startsAt))} (${madridTime(slot.startsAt)} – ${madridTime(slot.endsAt)})`)
                .join("; ")}.`,
            ),
      );
      draw();
    }, fail);
  });
  const recurring = h("details", { class: "card slot-form" }, h("summary", {}, h("strong", {}, "Turnos recurrentes")), recurringForm);

  const list = h("div", { class: "slot-days" });
  const draw = (): void => {
    const ordered = sortSlots(slots);
    if (ordered.length === 0) {
      list.replaceChildren(notice("info", "Todavía no has creado turnos de visita.", "Crea el primero con el formulario."));
      return;
    }
    const days = new Map<string, ShelterSlot[]>();
    for (const slot of ordered) {
      const key = madridDate(slot.startsAt);
      days.set(key, [...(days.get(key) ?? []), slot]);
    }
    list.replaceChildren(
      ...[...days.values()].map((daySlots) =>
        h("section", { class: "slot-day" }, h("h2", { class: "overline" }, DAY.format(new Date(daySlots[0]?.startsAt ?? ""))), ...daySlots.map(slotCard)),
      ),
    );
  };

  draw();
  root.append(message, createForm, recurring, list);
  return root;
}

/** CU-18, CU-19, CU-20, CU-50 · /protectora/turnos */
export async function renderShelterSlots(root: HTMLElement): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }
  if (user.role !== "SHELTER") {
    navigate("/inicio", { replace: true });
    return;
  }

  let content: Node;
  try {
    content = calendar((await listSlots()).slots);
  } catch (error) {
    content = notice("error", error instanceof ApiError ? error.message : "No se han podido cargar los turnos.");
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("p", { class: "overline" }, "Protectora"),
      h("h1", { class: "display" }, "Turnos de visita"),
      h("p", { class: "muted" }, "Publica los turnos en los que los adoptantes pueden visitar a tus mascotas. Las horas son de Madrid."),
      content,
    ]),
  );
}
