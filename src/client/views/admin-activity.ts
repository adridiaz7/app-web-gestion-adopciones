import type { AuditLogEntry, StatsResponse } from "../../shared/api.js";
import { getStats, listAuditLog } from "../api/admin.js";
import { currentUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { appLayout } from "../components/app-layout.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount, queryParam } from "../dom.js";
import { navigate } from "../router.js";

const ENTITIES: [string, string][] = [
  ["", "Cualquier elemento"],
  ["Visit", "Visita"],
  ["Adoption", "Adopción"],
  ["Block", "Bloqueo"],
  ["Pet", "Mascota"],
  ["Shelter", "Protectora"],
  ["Adopter", "Adoptante"],
  ["Suspension", "Suspensión"],
  ["Incident", "Incidencia"],
];
const dateTime = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" });
const days = (value: number | null): string => (value === null ? "—" : `${value.toLocaleString("es-ES")} días`);

/** CU-44, RN-160: the global indicators. */
function statsGrid(stats: StatsResponse["stats"]): HTMLElement {
  const item = (label: string, value: string) => h("div", { class: "facts__item" }, h("dt", {}, label), h("dd", {}, value));
  const a = stats.adoptions;
  return h(
    "dl",
    { class: "facts" },
    item("Adopciones completadas", String(a.completed)),
    item("Devoluciones", String(a.returned)),
    item("Solicitudes pendientes", String(a.pending)),
    item("Aprobadas sin entregar", String(a.approved)),
    item("Rechazadas / canceladas", `${String(a.rejected)} / ${String(a.cancelled)}`),
    item("Tiempo medio hasta decidir", days(stats.averageDaysToDecide)),
    item("Tiempo medio hasta la entrega", days(stats.averageDaysToDeliver)),
    item("Visitas realizadas / ausencias", `${String(stats.visits.completed)} / ${String(stats.visits.noShow)}`),
    item("Bloqueos activos / totales", `${String(stats.blocks.active)} / ${String(stats.blocks.total)}`),
    item("Incidencias abiertas / totales", `${String(stats.incidents.open)} / ${String(stats.incidents.total)}`),
  );
}

/** CU-43, RN-208: who did each action, when, and what changed. */
function entryRow(entry: AuditLogEntry): HTMLElement {
  const who = entry.actor ? `${entry.actor.email} (${entry.actor.role})` : "Sistema";
  const what = entry.entityType ? `${entry.entityType} #${String(entry.entityId ?? "")}` : "";
  return h(
    "tr",
    {},
    h("td", {}, dateTime.format(new Date(entry.createdAt))),
    h("td", {}, who),
    h("td", {}, entry.action),
    h("td", {}, what),
    h("td", {}, h("code", {}, JSON.stringify(entry.details))),
  );
}

/** CU-43, CU-44 · /admin/actividad: statistics and the audit log, filtered by item or by account. */
export async function renderAdminActivity(root: HTMLElement): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }
  if (user.role !== "ADMIN") {
    navigate("/inicio", { replace: true });
    return;
  }

  const query = new URLSearchParams();
  for (const name of ["entityType", "entityId", "actorId"]) if (queryParam(name)) query.set(name, queryParam(name));

  const type = h("select", { name: "entityType", "aria-label": "Tipo de elemento" }, ...ENTITIES.map(([value, label]) => h("option", { value, selected: value === queryParam("entityType") }, label)));
  const entityId = h("input", { name: "entityId", type: "number", min: "1", value: queryParam("entityId"), placeholder: "Nº del elemento", "aria-label": "Número del elemento" });
  const actorId = h("input", { name: "actorId", type: "number", min: "1", value: queryParam("actorId"), placeholder: "Nº de la cuenta", "aria-label": "Número de la cuenta que actuó" });
  const filters = h("form", { class: "filter-bar", role: "search" }, type, entityId, actorId, h("button", { type: "submit", class: "button button--secondary" }, "Buscar"));
  filters.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = new URLSearchParams();
    if (type.value) next.set("entityType", type.value);
    if (entityId.value) next.set("entityId", entityId.value);
    if (actorId.value) next.set("actorId", actorId.value);
    navigate(`/admin/actividad${next.size ? `?${next.toString()}` : ""}`);
  });

  let body: Node[];
  try {
    const [{ stats }, { entries }] = await Promise.all([getStats(), listAuditLog(query)]);
    body = [
      h("h2", { class: "overline" }, "Estadísticas"),
      statsGrid(stats),
      h("h2", { class: "overline" }, "Registro de auditoría"),
      filters,
      entries.length === 0
        ? notice("info", "No hay acciones que coincidan.")
        : h(
            "div",
            { class: "table-scroll" },
            h(
              "table",
              { class: "table" },
              h("thead", {}, h("tr", {}, h("th", {}, "Fecha"), h("th", {}, "Quién"), h("th", {}, "Acción"), h("th", {}, "Elemento"), h("th", {}, "Cambios"))),
              h("tbody", {}, ...entries.map(entryRow)),
            ),
          ),
    ];
  } catch (error) {
    body = [filters, notice("error", error instanceof ApiError ? error.message : "No se ha podido cargar la actividad.")];
  }

  mount(root, appLayout(user, navFor(user.role), [h("p", { class: "overline" }, "Administración"), h("h1", { class: "display" }, "Actividad"), ...body]));
}
