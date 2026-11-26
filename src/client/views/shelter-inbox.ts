import type { InboxVisit } from "../../shared/api.js";
import { currentUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { cancelVisitAsShelter, confirmVisit, getInbox, rejectVisit } from "../api/visits.js";
import { appLayout } from "../components/app-layout.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount } from "../dom.js";
import { madridTime } from "../madrid-time.js";
import { navigate } from "../router.js";

const DAY = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", weekday: "short", day: "numeric", month: "short" });
const DATE_TIME = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "medium", timeStyle: "short" });

const errorText = (error: unknown, fallback: string): string => (error instanceof ApiError ? error.message : fallback);

function inboxRow(visit: InboxVisit, actions: HTMLElement, note: string): HTMLElement {
  return h(
    "article",
    { class: "card visit-row visit-row--inbox" },
    h("div", {}, h("strong", {}, visit.petName), h("p", {}, h("a", { href: `/protectora/adoptantes/${String(visit.adopterId)}` }, visit.adopterName))),
    h("div", {}, h("strong", {}, DAY.format(new Date(visit.startsAt))), h("p", { class: "muted" }, `${madridTime(visit.startsAt)} – ${madridTime(visit.endsAt)}`)),
    h("span", { class: "muted" }, note),
    actions,
  );
}

/** CU-22 · /protectora/solicitudes: requests waiting for an answer and upcoming confirmed visits. */
export async function renderShelterInbox(root: HTMLElement): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }
  if (user.role !== "SHELTER") {
    navigate("/inicio", { replace: true });
    return;
  }

  const message = h("div", {});
  const reload = (): void => void renderShelterInbox(root);
  const fail = (error: unknown): void => {
    message.replaceChildren(notice("error", errorText(error, "No se ha podido guardar.")));
  };
  const button = (label: string, primary: boolean, onClick: () => void): HTMLButtonElement => {
    const b = h("button", { type: "button", class: `button button--small ${primary ? "button--primary" : "button--secondary"}` }, label);
    b.addEventListener("click", onClick);
    return b;
  };

  let content: Node[];
  try {
    const { pending, upcoming } = await getInbox();
    // CU-24: confirm or reject (RN-96: optional reason).
    const pendingRow = (visit: InboxVisit): HTMLElement =>
      inboxRow(
        visit,
        h(
          "span",
          { class: "slot-card__actions" },
          button("Confirmar", true, () => {
            confirmVisit(visit.id).then(reload, fail);
          }),
          button("Rechazar", false, () => {
            const reason = window.prompt("Motivo del rechazo (opcional):");
            if (reason === null) return;
            rejectVisit(visit.id, { reason }).then(reload, fail);
          }),
        ),
        visit.respondBy ? `Responde antes del ${DATE_TIME.format(new Date(visit.respondBy))}` : "",
      );
    // CU-25, RN-100: the shelter can cancel a confirmed visit at any time.
    const upcomingRow = (visit: InboxVisit): HTMLElement =>
      inboxRow(
        visit,
        h(
          "span",
          { class: "slot-card__actions" },
          button("Cancelar visita", false, () => {
            if (!window.confirm(`¿Cancelar la visita de ${visit.adopterName} para conocer a ${visit.petName}? Le avisaremos.`)) return;
            cancelVisitAsShelter(visit.id).then(reload, fail);
          }),
        ),
        "Confirmada",
      );
    content = [
      message,
      h("h2", { class: "overline" }, "Solicitudes pendientes"),
      pending.length === 0
        ? notice("info", "No hay solicitudes pendientes.")
        : h("div", { class: "visit-list" }, ...pending.map(pendingRow)),
      h("h2", { class: "overline" }, "Próximas visitas confirmadas"),
      upcoming.length === 0
        ? notice("info", "No hay visitas confirmadas próximas.")
        : h("div", { class: "visit-list" }, ...upcoming.map(upcomingRow)),
    ];
  } catch (error) {
    content = [notice("error", errorText(error, "No se ha podido cargar la bandeja."))];
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("p", { class: "overline" }, "Protectora"),
      h("h1", { class: "display" }, "Solicitudes"),
      h("p", { class: "muted" }, "Responde a las solicitudes de visita antes de que caduquen. Las horas son de Madrid."),
      ...content,
    ]),
  );
}
