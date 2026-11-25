import type { Candidate, Household } from "../../shared/api.js";
import { currentUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { approveAdoption, listCandidates, rejectAdoption } from "../api/adoptions.js";
import { appLayout } from "../components/app-layout.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount } from "../dom.js";
import { navigate, type RouteParams } from "../router.js";

const DATE = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long", year: "numeric" });
const HOUSING: Record<string, string> = { APARTMENT: "Piso", HOUSE: "Casa", OTHER: "Otro" };
const TENURE: Record<string, string> = { OWNED: "En propiedad", RENTED: "De alquiler", RENT_TO_OWN: "Alquiler con opción a compra" };
const yesNo = (value: boolean | null | undefined): string => (value === null || value === undefined ? "—" : value ? "Sí" : "No");
const errorText = (error: unknown, fallback: string): string => (error instanceof ApiError ? error.message : fallback);

/** RN-27: the household data as label–value rows. */
function householdList(household: Household): HTMLElement {
  const rows: [string, string][] = [
    ["Vivienda", `${HOUSING[household.housingType ?? ""] ?? "—"} · ${TENURE[household.housingTenure ?? ""] ?? "—"}`],
    ["Jardín o terraza", yesNo(household.hasOutdoorSpace)],
    ["Personas en casa", household.householdMembers === null ? "—" : String(household.householdMembers)],
    ["Niños", yesNo(household.hasChildren)],
    ["Otras mascotas", household.hasOtherPets && household.otherPetsDescription ? `Sí: ${household.otherPetsDescription}` : yesNo(household.hasOtherPets)],
    ["Experiencia previa", yesNo(household.hasPetExperience)],
    ["Horas sola al día", household.hoursAlonePerDay === null ? "—" : String(household.hoursAlonePerDay)],
  ];
  return h("dl", { class: "candidate__data" }, ...rows.flatMap(([label, value]) => [h("dt", {}, label), h("dd", {}, value)]));
}

function candidateCard(candidate: Candidate, onDone: () => void): HTMLElement {
  const message = h("div", {});
  const approve = h("button", { type: "button", class: "button button--primary" }, "Aprobar");
  const reject = h("button", { type: "button", class: "button button--secondary" }, "Rechazar");
  const fail = (error: unknown): void => {
    approve.disabled = false;
    reject.disabled = false;
    message.replaceChildren(notice("error", errorText(error, "No se ha podido guardar la decisión.")));
  };
  approve.addEventListener("click", () => {
    if (!window.confirm(`¿Aprobar la adopción de ${candidate.name}? La mascota quedará reservada y el resto de candidatos no serán seleccionados.`)) return;
    approve.disabled = true;
    approveAdoption(candidate.adoptionId).then(onDone, fail);
  });
  reject.addEventListener("click", () => {
    // RN-123: the reason is required; the server checks it.
    const reason = window.prompt(`Motivo del rechazo para ${candidate.name} (se le enviará):`);
    if (reason === null) return;
    reject.disabled = true;
    rejectAdoption(candidate.adoptionId, { reason }).then(onDone, fail);
  });

  return h(
    "article",
    { class: "card candidate" },
    h("h2", {}, candidate.name),
    h("p", { class: "muted" }, `${candidate.locality} (${candidate.provinceName}) · ${candidate.email} · ${candidate.phone}`),
    h("p", { class: "muted" }, `Visitó a la mascota el ${DATE.format(new Date(candidate.visitedAt))} · Solicitud del ${DATE.format(new Date(candidate.requestedAt))}`),
    householdList(candidate.household),
    h("h3", {}, "Respuestas"),
    h("p", {}, h("strong", {}, "Por qué quiere adoptar: "), candidate.answers.reason ?? "Sin respuesta"),
    h("p", {}, h("strong", {}, "Puede hacerse cargo de los gastos: "), yesNo(candidate.answers.canAffordCosts)),
    message,
    h("div", { class: "candidate__actions" }, reject, approve),
  );
}

/** CU-28, CU-29 · /protectora/mascotas/:id/candidatos: compare the pending requests and decide. */
export async function renderShelterCandidates(root: HTMLElement, params: RouteParams): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }
  if (user.role !== "SHELTER") {
    navigate("/inicio", { replace: true });
    return;
  }

  const petId = Number(params["id"]);
  let title = "Candidatos";
  let body: Node[];
  try {
    const { pet, candidates } = await listCandidates(petId);
    title = `Candidatos para ${pet.name}`;
    body =
      candidates.length === 0
        ? [notice("info", `${pet.name} no tiene solicitudes de adopción pendientes.`)]
        : [h("div", { class: "candidate-list" }, ...candidates.map((candidate) => candidateCard(candidate, () => void renderShelterCandidates(root, params))))];
  } catch (error) {
    body = [notice("error", errorText(error, "No se han podido cargar los candidatos."))];
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("a", { class: "back-link", href: `/protectora/mascotas/${String(petId)}` }, "← Volver a la mascota"),
      h("h1", { class: "display" }, title),
      h("p", { class: "muted" }, "Compara las solicitudes pendientes con los datos de cada hogar y elige el mejor."),
      ...body,
    ]),
  );
}
