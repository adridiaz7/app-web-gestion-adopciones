import type { ShelterAdopterResponse } from "../../shared/api.js";
import { currentUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { getShelterAdopter } from "../api/visits.js";
import { appLayout } from "../components/app-layout.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount } from "../dom.js";
import { madridTime } from "../madrid-time.js";
import { navigate, type RouteParams } from "../router.js";
import { householdList } from "./shelter-candidates.js";
import { VISIT_STATUS_LABELS } from "./visits.js";

const DAY = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", weekday: "short", day: "numeric", month: "short", year: "numeric" });

function history(visits: ShelterAdopterResponse["adopter"]["visits"]): HTMLElement {
  if (visits.length === 0) return notice("info", "Sin visitas", "Este adoptante todavía no tiene visitas con tu protectora.");
  return h(
    "div",
    { class: "visit-list" },
    ...visits.map((visit) =>
      h(
        "article",
        { class: "card visit-row visit-row--inbox" },
        h("div", {}, h("strong", {}, visit.petName)),
        h("div", {}, h("strong", {}, DAY.format(new Date(visit.startsAt))), h("p", { class: "muted" }, `${madridTime(visit.startsAt)} – ${madridTime(visit.endsAt)}`)),
        h("span", { class: `badge badge--visit-${visit.status.toLowerCase()}` }, VISIT_STATUS_LABELS[visit.status]),
      ),
    ),
  );
}

/** CU-22, RN-27, RN-29 · /protectora/adoptantes/:id: an adopter's data and their history with this shelter. */
export async function renderShelterAdopter(root: HTMLElement, params: RouteParams): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }
  if (user.role !== "SHELTER") {
    navigate("/inicio", { replace: true });
    return;
  }

  let title = "Adoptante";
  let body: Node[];
  try {
    const { adopter } = await getShelterAdopter(Number(params["id"]));
    title = adopter.name;
    const noShows = adopter.noShows === 1 ? "1 visita no asistida" : `${String(adopter.noShows)} visitas no asistidas`;
    body = [
      h("p", { class: "muted" }, adopter.provinceName),
      h("section", { class: "card candidate" }, h("h2", {}, "Datos del hogar"), householdList(adopter.household)),
      h("h2", {}, "Historial con tu protectora"),
      h("p", { class: "muted" }, `${adopter.visits.length === 1 ? "1 visita" : `${String(adopter.visits.length)} visitas`} · ${noShows}`),
      history(adopter.visits),
    ];
  } catch (error) {
    body = [notice("error", error instanceof ApiError ? error.message : "No se ha podido cargar el adoptante.")];
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("p", { class: "overline" }, "Adoptante"),
      h("h1", { class: "display" }, title),
      ...body,
      h("a", { class: "button button--secondary", href: "/protectora/solicitudes" }, "Volver a solicitudes"),
    ]),
  );
}
