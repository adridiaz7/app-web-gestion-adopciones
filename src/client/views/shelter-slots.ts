import type { ShelterSlot, SlotRequest } from "../../shared/api.js";
import { currentUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { createSlot, deleteSlot, listSlots, updateSlot } from "../api/slots.js";
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
  root.append(message, createForm, list);
  return root;
}

/** CU-18, CU-19, CU-20 · /protectora/turnos */
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
