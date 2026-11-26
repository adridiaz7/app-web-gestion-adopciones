import type { AdopterAdoptionsResponse, AdopterVisit, ShelterQuota, VisitStatus } from "../../shared/api.js";
import { cancelMyAdoption, listMyAdoptions } from "../api/adoptions.js";
import { currentUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { cancelVisit, listMyVisits } from "../api/visits.js";
import { appLayout } from "../components/app-layout.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { openReplaceDialog, openRescheduleDialog } from "../components/visit-request.js";
import { h, mount, queryParam } from "../dom.js";
import { madridTime } from "../madrid-time.js";
import { navigate } from "../router.js";

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  REJECTED: "Rechazada",
  CANCELLED: "Cancelada",
  EXPIRED: "Caducada",
  VOIDED: "Anulada",
  COMPLETED: "Realizada",
  NO_SHOW: "No asistida",
};

const VOID_REASONS: Record<string, string> = {
  PET_RESERVED: "La mascota ha quedado reservada",
  PET_UNLISTED: "La mascota se ha dado de baja",
  ADOPTER_BLOCKED: "La protectora ha restringido tu acceso",
  NO_SHOW: "Tienes una visita no asistida en esta protectora",
  SLOT_CANCELLED: "La protectora cambió o eliminó el turno",
  ADOPTER_SUSPENDED: "Tu cuenta está suspendida",
  ACCOUNT_DELETED: "La cuenta se ha eliminado",
};

const DAY = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", weekday: "short", day: "numeric", month: "short" });
const DATE = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long", year: "numeric" });

const ADOPTION_STATUS_LABELS: Record<string, string> = {
  PENDING: "Solicitud pendiente",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  NOT_SELECTED: "No seleccionada",
  CANCELLED: "Cancelada",
  VOIDED: "Anulada",
  COMPLETED: "Completada",
  RETURNED: "Devuelta",
};

/** CU-21, CU-30: the adopter's adoptions; a pending or approved one can be cancelled with a reason (RN-129). */
function adoptionList(adoptions: AdopterAdoptionsResponse["adoptions"], onCancel: (id: number, petName: string) => void): HTMLElement {
  return h(
    "div",
    { class: "visit-list" },
    ...adoptions.map((adoption) => {
      const side = h("div", { class: "visit-row__side" });
      if (adoption.status === "PENDING" || adoption.status === "APPROVED") {
        const cancel = h("button", { type: "button", class: "button button--secondary button--small" }, "Cancelar");
        cancel.addEventListener("click", () => {
          onCancel(adoption.id, adoption.petName);
        });
        side.append(cancel);
      }
      return h(
        "article",
        { class: "card visit-row" },
        h("div", {}, h("a", { href: `/mascotas/${String(adoption.petId)}` }, h("strong", {}, adoption.petName)), h("p", { class: "muted" }, adoption.shelterName)),
        h("div", {}, h("p", { class: "muted" }, `Solicitada el ${DATE.format(new Date(adoption.requestedAt))}`)),
        h("span", { class: "badge" }, ADOPTION_STATUS_LABELS[adoption.status] ?? adoption.status),
        side,
      );
    }),
  );
}

const isUpcoming = (visit: AdopterVisit): boolean => visit.status === "PENDING" || visit.status === "CONFIRMED";

/** CU-21, RN-89, RN-90, RN-93: one card per shelter with the quota used and when a place frees up. */
function quotaCard(quota: ShelterQuota): HTMLElement {
  if (quota.noShow) {
    return h(
      "article",
      { class: "card quota-card" },
      h("p", { class: "overline" }, quota.shelterName),
      h("p", {}, h("strong", {}, "No puedes solicitar visitas")),
      h("p", { class: "muted" }, "Tienes una visita no asistida en esta protectora."),
    );
  }
  const bars = Array.from({ length: quota.limit }, (_, index) =>
    h("span", { class: `quota-card__bar${index < quota.used ? " quota-card__bar--used" : ""}` }),
  );
  const next = quota.nextPlaceAt ? ` · próxima plaza libre el ${DATE.format(new Date(quota.nextPlaceAt))}` : "";
  return h(
    "article",
    { class: "card quota-card" },
    h("p", { class: "overline" }, quota.shelterName),
    h("div", { class: "quota-card__bars", "aria-hidden": "true" }, ...bars),
    h("p", {}, h("strong", {}, `${String(quota.used)} de ${String(quota.limit)} visitas usadas`)),
    h("p", { class: "muted" }, `En los últimos ${String(quota.windowMonths)} meses${next}`),
  );
}

/** Why a closed visit closed (RN-96, RN-101, RN-109). */
function closedText(visit: AdopterVisit): string {
  switch (visit.status) {
    case "REJECTED":
      return visit.rejectionReason ? `Motivo: ${visit.rejectionReason}` : "La protectora la rechazó";
    case "CANCELLED":
      return visit.cancelledBy === "SHELTER" ? "La protectora la canceló" : "La cancelaste";
    case "EXPIRED":
      return "La protectora no respondió a tiempo";
    case "VOIDED":
      return VOID_REASONS[visit.voidReason ?? ""] ?? "Anulada";
    case "NO_SHOW":
      return "La protectora registró tu ausencia";
    default:
      return "";
  }
}

interface RowActions {
  onCancel: (visit: AdopterVisit) => void;
  onReschedule: (visit: AdopterVisit) => void;
  onReplace: (visit: AdopterVisit) => void;
}

function visitRow(visit: AdopterVisit, { onCancel, onReschedule, onReplace }: RowActions): HTMLElement {
  const side = h("div", { class: "visit-row__side" });
  if (visit.status === "PENDING") side.append(h("span", { class: "muted" }, "Pendiente de respuesta de la protectora"));
  if (isUpcoming(visit)) {
    // RN-97, RN-98, RN-195: the server says whether there is still enough notice to cancel or reschedule.
    if (visit.canCancel) {
      const reschedule = h("button", { type: "button", class: "button button--secondary button--small" }, "Reprogramar");
      reschedule.addEventListener("click", () => {
        onReschedule(visit);
      });
      const cancel = h("button", { type: "button", class: "button button--secondary button--small" }, "Cancelar");
      cancel.addEventListener("click", () => {
        onCancel(visit);
      });
      side.append(reschedule, cancel);
    } else {
      side.append(h("span", { class: "muted" }, "Ya no se puede cancelar ni reprogramar"));
    }
  } else {
    side.append(h("span", { class: "muted" }, closedText(visit)));
    // RN-111: the server checks that it was confirmed and has not been replaced yet.
    if (visit.status === "VOIDED" && visit.voidReason === "SLOT_CANCELLED") {
      const replace = h("button", { type: "button", class: "button button--primary button--small" }, "Elegir otro turno");
      replace.addEventListener("click", () => {
        onReplace(visit);
      });
      side.append(replace);
    }
    // CU-36, CU-38: a no-show the adopter disagrees with is claimed through an incident.
    if (visit.status === "NO_SHOW") {
      side.append(
        h("a", { class: "button button--secondary button--small", href: `/incidencias/nueva?usuario=${String(visit.shelterId)}&visita=${String(visit.id)}` }, "Reclamar la ausencia"),
      );
    }
  }
  return h(
    "article",
    { class: "card visit-row" },
    visit.photoUrl
      ? h("img", { class: "visit-row__photo", src: visit.photoUrl, alt: "" })
      : h("div", { class: "visit-row__photo visit-row__photo--empty", "aria-hidden": "true" }, "🐾"),
    h("div", {}, h("a", { href: `/mascotas/${String(visit.petId)}` }, h("strong", {}, visit.petName)), h("p", { class: "muted" }, visit.shelterName)),
    h("div", {}, h("strong", {}, DAY.format(new Date(visit.startsAt))), h("p", { class: "muted" }, `${madridTime(visit.startsAt)} – ${madridTime(visit.endsAt)}`)),
    h("span", { class: `badge badge--visit-${visit.status.toLowerCase()}` }, VISIT_STATUS_LABELS[visit.status]),
    side,
  );
}

/** CU-21 · /visitas: upcoming visits and history, with the quota at each shelter. */
export async function renderVisits(root: HTMLElement): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }
  if (user.role !== "ADOPTER") {
    navigate("/inicio", { replace: true });
    return;
  }

  const history = queryParam("pestana") === "historial";
  const message = h("div", {});
  let content: Node[];
  try {
    const [{ visits, quotas }, { adoptions }] = await Promise.all([listMyVisits(), listMyAdoptions()]);
    const onCancelAdoption = (id: number, petName: string): void => {
      const reason = window.prompt(`Motivo para cancelar la adopción de ${petName}:`);
      if (reason === null) return;
      cancelMyAdoption(id, { reason }).then(
        () => void renderVisits(root),
        (error: unknown) => message.replaceChildren(notice("error", error instanceof ApiError ? error.message : "No se ha podido cancelar la adopción.")),
      );
    };
    const upcoming = visits.filter(isUpcoming);
    const past = visits.filter((visit) => !isUpcoming(visit)).reverse();
    const shown = history ? past : upcoming;
    const onCancel = (visit: AdopterVisit): void => {
      if (!window.confirm(`¿Cancelar la visita para conocer a ${visit.petName}?`)) return;
      cancelVisit(visit.id).then(
        () => void renderVisits(root),
        (error: unknown) => message.replaceChildren(notice("error", error instanceof ApiError ? error.message : "No se ha podido cancelar la visita.")),
      );
    };
    const onReschedule = (visit: AdopterVisit): void => {
      openRescheduleDialog(visit, () => void renderVisits(root));
    };
    const onReplace = (visit: AdopterVisit): void => {
      openReplaceDialog(visit, () => void renderVisits(root));
    };
    const tab = (label: string, count: number, href: string, current: boolean) =>
      h("a", { class: "tabs__tab", href, "aria-current": current ? "page" : undefined }, `${label} (${String(count)})`);
    content = [
      h("nav", { class: "tabs", "aria-label": "Visitas" }, tab("Próximas", upcoming.length, "/visitas", !history), tab("Historial", past.length, "/visitas?pestana=historial", history)),
      quotas.length > 0 ? h("div", { class: "quota-list" }, ...quotas.map(quotaCard)) : null,
      message,
      shown.length === 0
        ? notice("info", history ? "Todavía no tienes visitas pasadas." : "No tienes visitas próximas.", "Solicita una visita desde la ficha de una mascota.")
        : h("div", { class: "visit-list" }, ...shown.map((visit) => visitRow(visit, { onCancel, onReschedule, onReplace }))),
      adoptions.length > 0 ? h("h2", { class: "overline" }, "Mis adopciones") : null,
      adoptions.length > 0 ? adoptionList(adoptions, onCancelAdoption) : null,
    ].filter((node): node is HTMLElement => node !== null);
  } catch (error) {
    content = [notice("error", error instanceof ApiError ? error.message : "No se han podido cargar tus visitas.")];
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("h1", { class: "display" }, "Visitas"),
      h("p", { class: "muted" }, "Tus solicitudes de visita y las visitas que ya has hecho. Las horas son de Madrid."),
      ...content,
    ]),
  );
}
