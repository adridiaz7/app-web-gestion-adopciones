import type { AdminIncident, IncidentReason } from "../../shared/api.js";
import { currentUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { changeIncidentStatus, correctAttendance, listIncidents, openIncident } from "../api/incidents.js";
import { appLayout } from "../components/app-layout.js";
import { onSubmit, selectField, submitButton, textValue } from "../components/form.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount, queryParam } from "../dom.js";
import { navigate } from "../router.js";

/** RN-167 */
const REASONS: Record<IncidentReason, string> = {
  WRONG_ATTENDANCE: "Asistencia mal registrada",
  INAPPROPRIATE_BEHAVIOUR: "Comportamiento inadecuado",
  FALSE_INFORMATION: "Información falsa",
  INAPPROPRIATE_CONTENT: "Contenido inapropiado",
  UNFAIR_BLOCK: "Bloqueo injusto",
  OTHER: "Otro",
};

const isReason = (value: string): value is IncidentReason => value in REASONS;
const positive = (value: string | null): number | null => (value && Number(value) > 0 ? Number(value) : null);

/**
 * CU-36 · /incidencias/nueva?usuario=…[&visita=…|&adopcion=…]: an adopter or a shelter
 * reports the other side to the administrator. The other side is not told (RN-170).
 */
export async function renderNewIncident(root: HTMLElement): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }
  if (user.role === "ADMIN") {
    navigate("/inicio", { replace: true });
    return;
  }

  const reportedId = positive(queryParam("usuario"));
  const visitId = positive(queryParam("visita"));
  const adoptionId = positive(queryParam("adopcion"));
  const area = h("textarea", { id: "field-description", name: "description", rows: "6", maxlength: "5000" });
  const form = h(
    "form",
    { class: "form card" },
    selectField(
      "reason",
      "Motivo",
      Object.entries(REASONS).map(([value, label]) => ({ value, label })),
    ),
    h("div", { class: "field", "data-field": "description" }, h("label", { for: "field-description" }, "Explica qué ha pasado"), area, h("p", { class: "field__error" })),
    submitButton("Enviar la incidencia"),
  );
  onSubmit(form, async () => {
    const reason = textValue(form, "reason");
    if (!isReason(reason)) throw new ApiError(400, "Elige el motivo de la incidencia.", { reason: "Elige el motivo de la incidencia." });
    await openIncident({ reportedId: reportedId ?? 0, reason, description: textValue(form, "description"), visitId, adoptionId });
    form.replaceWith(notice("success", "Incidencia enviada.", "El administrador la revisará y te avisaremos cuando la resuelva."));
  });

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("h1", { class: "display" }, "Abrir una incidencia"),
      h("p", { class: "muted" }, "Cuéntale al administrador el problema. La otra parte no recibe ningún aviso."),
      reportedId ? form : notice("error", "Falta indicar a quién se refiere la incidencia."),
    ]),
  );
}

const TABS: { status: AdminIncident["status"]; label: string }[] = [
  { status: "OPEN", label: "Abiertas" },
  { status: "IN_REVIEW", label: "En revisión" },
  { status: "RESOLVED", label: "Resueltas" },
  { status: "DISMISSED", label: "Descartadas" },
];
const dateFormat = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "Europe/Madrid" });

function incidentCard(incident: AdminIncident, reload: (message: HTMLElement) => void): HTMLElement {
  const fail = (error: unknown): void => {
    reload(notice("error", error instanceof ApiError ? error.message : "No se ha podido completar la acción."));
  };
  const actions: Node[] = [];
  if (incident.status === "OPEN") {
    const review = h("button", { type: "button", class: "button button--secondary button--small" }, "Pasar a revisión");
    review.addEventListener("click", () => {
      changeIncidentStatus(incident.id, { status: "IN_REVIEW" })
        .then(() => {
          reload(notice("success", "La incidencia está en revisión."));
        })
        .catch(fail);
    });
    actions.push(review);
  }
  if (incident.status === "OPEN" || incident.status === "IN_REVIEW") {
    if (incident.reason === "WRONG_ATTENDANCE" && incident.visitId !== null) {
      const visitId = incident.visitId;
      const fix = h("button", { type: "button", class: "button button--secondary button--small" }, "Corregir la asistencia a realizada");
      fix.addEventListener("click", () => {
        correctAttendance(visitId)
          .then(() => {
            reload(notice("success", "La visita consta ahora como realizada."));
          })
          .catch(fail);
      });
      actions.push(fix);
    }
    const close = h(
      "form",
      { class: "form reason-form" },
      h("div", { class: "field", "data-field": "resolution" }, h("label", {}, "Resolución", h("textarea", { name: "resolution", rows: "3", maxlength: "5000" })), h("p", { class: "field__error" })),
      h(
        "div",
        { class: "button-row" },
        h("button", { type: "submit", name: "close", value: "RESOLVED", class: "button button--primary button--small" }, "Resolver"),
        h("button", { type: "submit", name: "close", value: "DISMISSED", class: "button button--secondary button--small" }, "Descartar"),
      ),
    );
    let closeAs: "RESOLVED" | "DISMISSED" = "RESOLVED";
    close.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof HTMLButtonElement && target.value === "DISMISSED") closeAs = "DISMISSED";
      else if (target instanceof HTMLButtonElement) closeAs = "RESOLVED";
    });
    onSubmit(close, async () => {
      await changeIncidentStatus(incident.id, { status: closeAs, resolution: textValue(close, "resolution") });
      reload(notice("success", closeAs === "RESOLVED" ? "Incidencia resuelta." : "Incidencia descartada."));
    });
    actions.push(close);
  }

  const link = incident.visitId !== null ? ` · visita n.º ${String(incident.visitId)}` : incident.adoptionId !== null ? ` · adopción n.º ${String(incident.adoptionId)}` : "";
  return h(
    "article",
    { class: "card form" },
    h("h2", {}, REASONS[incident.reason]),
    h("p", { class: "muted" }, `${dateFormat.format(new Date(incident.createdAt))} · de ${incident.reporterEmail} sobre ${incident.reportedEmail}${link}`),
    h("p", { class: "note__body" }, incident.description),
    incident.resolution ? h("p", {}, `Resolución: ${incident.resolution}`) : "",
    ...actions,
  );
}

/** CU-37, CU-38 · /admin/incidencias: the administrator reviews and closes incidents. */
export async function renderAdminIncidents(root: HTMLElement): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }
  if (user.role !== "ADMIN") {
    navigate("/inicio", { replace: true });
    return;
  }

  const status = TABS.find((tab) => tab.status === queryParam("estado"))?.status ?? "OPEN";
  const list = h("div", { class: "visit-list" });
  const load = (message: HTMLElement | null = null): void => {
    listIncidents(status)
      .then(({ incidents }) => {
        const reload = (text: HTMLElement): void => {
          load(text);
        };
        list.replaceChildren(
          message ?? "",
          ...(incidents.length === 0 ? [h("p", { class: "muted" }, "No hay incidencias en este estado.")] : incidents.map((i) => incidentCard(i, reload))),
        );
      })
      .catch((error: unknown) => {
        list.replaceChildren(notice("error", error instanceof ApiError ? error.message : "No se han podido cargar las incidencias."));
      });
  };
  load();

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("h1", { class: "display" }, "Incidencias"),
      h(
        "nav",
        { class: "tabs", "aria-label": "Estado" },
        ...TABS.map((tab) => h("a", { class: "tab", href: `/admin/incidencias?estado=${tab.status}`, "aria-current": tab.status === status ? "page" : undefined }, tab.label)),
      ),
      list,
    ]),
  );
}
