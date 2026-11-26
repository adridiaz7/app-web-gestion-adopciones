import type { AdminUser, SuspensionReason } from "../../shared/api.js";
import { listUsers, reactivateUser, suspendUser } from "../api/admin.js";
import { currentUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { appLayout } from "../components/app-layout.js";
import { onSubmit, selectField, textValue } from "../components/form.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount, queryParam } from "../dom.js";
import { navigate } from "../router.js";

/** RN-155 */
const REASONS: Record<SuspensionReason, string> = {
  INAPPROPRIATE_BEHAVIOUR: "Comportamiento inadecuado",
  FALSE_INFORMATION: "Información falsa",
  INAPPROPRIATE_CONTENT: "Contenido inapropiado",
  FRAUD: "Fraude",
  REPEATED_INCIDENTS: "Incidencias reiteradas",
  OTHER: "Otro",
};

const ROLES: Record<AdminUser["role"], string> = { ADOPTER: "Adoptante", SHELTER: "Protectora" };
const dateFormat = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "Europe/Madrid" });

/** CU-40: reason (required) and detail (optional) of the suspension. */
function suspendForm(user: AdminUser, done: () => void): HTMLFormElement {
  const form = h(
    "form",
    { class: "form reason-form" },
    selectField("reason", "Motivo de la suspensión", [{ value: "", label: "Elige un motivo" }, ...Object.entries(REASONS).map(([value, label]) => ({ value, label }))]),
    h("div", { class: "field", "data-field": "detail" }, h("label", {}, "Detalle (opcional)", h("textarea", { name: "detail", rows: "2", maxlength: "1000" })), h("p", { class: "field__error" })),
    h("button", { type: "submit", class: "button button--secondary button--small" }, "Suspender cuenta"),
  );
  onSubmit(form, async () => {
    const reason = textValue(form, "reason") as SuspensionReason;
    await suspendUser(user.id, { reason, detail: textValue(form, "detail") || null });
    done();
  });
  return form;
}

function userCard(user: AdminUser, reload: () => void): HTMLElement {
  const actions = h("div", { class: "shelter-card__actions" });
  if (user.suspension) {
    const reactivate = h("button", { type: "button", class: "button button--primary button--small" }, "Reactivar cuenta");
    reactivate.addEventListener("click", () => {
      reactivate.disabled = true;
      reactivateUser(user.id)
        .then(reload)
        .catch((error: unknown) => {
          reactivate.disabled = false;
          actions.append(notice("error", error instanceof ApiError ? error.message : "No se ha podido reactivar."));
        });
    });
    actions.append(reactivate);
  } else {
    const suspend = h("button", { type: "button", class: "button button--secondary button--small" }, "Suspender…");
    suspend.addEventListener("click", () => {
      actions.replaceChildren(suspendForm(user, reload));
    });
    actions.append(suspend);
  }

  return h(
    "article",
    { class: "card shelter-card" },
    h("h2", { class: "shelter-card__name" }, user.name),
    h(
      "dl",
      { class: "shelter-card__data" },
      h("dt", {}, "Tipo"),
      h("dd", {}, ROLES[user.role]),
      h("dt", {}, "Email"),
      h("dd", {}, user.email),
      h("dt", {}, "Estado"),
      h("dd", {}, user.suspension ? `Suspendida desde el ${dateFormat.format(new Date(user.suspension.startedAt))}` : "Activa"),
      user.suspension ? h("dt", {}, "Motivo") : null,
      user.suspension ? h("dd", {}, [REASONS[user.suspension.reason], user.suspension.detail].filter(Boolean).join(" · ")) : null,
    ),
    actions,
  );
}

/** CU-40 · /admin/cuentas: search adopters and shelters, suspend and reactivate them. */
export async function renderAdminUsers(root: HTMLElement): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }
  if (user.role !== "ADMIN") {
    navigate("/inicio", { replace: true });
    return;
  }

  const query = queryParam("q");
  const reload = () => void renderAdminUsers(root);
  const input = h("input", { type: "search", name: "q", value: query, placeholder: "Nombre o email", "aria-label": "Buscar por nombre o email" });
  const search = h("form", { class: "filter-bar", role: "search" }, input, h("button", { type: "submit", class: "button button--secondary" }, "Buscar"));
  search.addEventListener("submit", (event) => {
    event.preventDefault();
    navigate(`/admin/cuentas${input.value.trim() ? `?q=${encodeURIComponent(input.value.trim())}` : ""}`);
  });

  let list: Node;
  try {
    const { users } = await listUsers(query);
    list = users.length === 0 ? notice("info", "No hay cuentas que coincidan.") : h("div", { class: "shelter-list" }, ...users.map((u) => userCard(u, reload)));
  } catch (error) {
    list = notice("error", error instanceof ApiError ? error.message : "No se han podido cargar las cuentas.");
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("p", { class: "overline" }, "Administración"),
      h("h1", { class: "display" }, "Cuentas"),
      h("p", { class: "muted" }, "Una cuenta suspendida no puede iniciar sesión. Las visitas y adopciones abiertas de un adoptante se anulan al suspenderlo."),
      search,
      list,
    ]),
  );
}
