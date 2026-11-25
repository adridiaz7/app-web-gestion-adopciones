import type { AdminShelter, ValidationStatus } from "../../shared/api.js";
import { listShelters, rejectShelter, revokeShelter, validateShelter } from "../api/admin.js";
import { currentUser } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import { appLayout } from "../components/app-layout.js";
import { onSubmit, textValue } from "../components/form.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount, queryParam } from "../dom.js";
import { navigate } from "../router.js";

const TABS: { status: ValidationStatus; label: string }[] = [
  { status: "PENDING", label: "Pendientes" },
  { status: "VALIDATED", label: "Validadas" },
  { status: "REJECTED", label: "Rechazadas" },
];

const dateFormat = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "Europe/Madrid" });

function currentStatus(): ValidationStatus {
  const status = queryParam("estado");
  return TABS.find((tab) => tab.status === status)?.status ?? "PENDING";
}

/** Form with the required reason, to reject (RN-18) or revoke (RN-19). */
function reasonForm(label: string, buttonLabel: string, send: (reason: string) => Promise<unknown>, done: () => void): HTMLFormElement {
  const form = h(
    "form",
    { class: "form reason-form" },
    h(
      "div",
      { class: "field", "data-field": "reason" },
      h("label", {}, label, h("textarea", { name: "reason", rows: "3", maxlength: "1000" })),
      h("p", { class: "field__error" }),
    ),
    h("button", { type: "submit", class: "button button--secondary button--small" }, buttonLabel),
  );
  onSubmit(form, async () => {
    await send(textValue(form, "reason"));
    done();
  });
  return form;
}

/** Button that validates the shelter (CU-39; T-45: also a rejected or revoked one). */
function validateButton(shelter: AdminShelter, label: string, actions: HTMLElement, reload: () => void): HTMLButtonElement {
  const validate = h("button", { type: "button", class: "button button--primary button--small" }, label);
  validate.addEventListener("click", () => {
    validate.disabled = true;
    validateShelter(shelter.id)
      .then(reload)
      .catch((error: unknown) => {
        validate.disabled = false;
        actions.append(notice("error", error instanceof ApiError ? error.message : "No se ha podido validar."));
      });
  });
  return validate;
}

function shelterCard(shelter: AdminShelter, reload: () => void): HTMLElement {
  const actions = h("div", { class: "shelter-card__actions" });

  if (shelter.validationStatus === "PENDING") {
    const validate = validateButton(shelter, "Validar", actions, reload);
    const reject = h("button", { type: "button", class: "button button--secondary button--small" }, "Rechazar…");
    reject.addEventListener("click", () => {
      actions.replaceChildren(reasonForm("Motivo del rechazo", "Rechazar protectora", (reason) => rejectShelter(shelter.id, reason), reload));
    });
    actions.append(validate, reject);
  } else if (shelter.validationStatus === "VALIDATED") {
    const revoke = h("button", { type: "button", class: "button button--secondary button--small" }, "Revocar validación…");
    revoke.addEventListener("click", () => {
      actions.replaceChildren(
        reasonForm("Motivo de la revocación", "Revocar validación", (reason) => revokeShelter(shelter.id, reason), reload),
      );
    });
    actions.append(revoke);
  } else {
    actions.append(validateButton(shelter, "Volver a validar", actions, reload));
  }

  return h(
    "article",
    { class: "card shelter-card" },
    h("h2", { class: "shelter-card__name" }, shelter.name),
    h(
      "dl",
      { class: "shelter-card__data" },
      h("dt", {}, "CIF"),
      h("dd", {}, shelter.cif),
      h("dt", {}, "Email"),
      h("dd", {}, shelter.email),
      h("dt", {}, "Teléfono"),
      h("dd", {}, shelter.phone),
      h("dt", {}, "Dirección"),
      h("dd", {}, `${shelter.address}, ${shelter.locality} (${shelter.provinceName})`),
      h("dt", {}, "Registro"),
      h("dd", {}, dateFormat.format(new Date(shelter.registeredAt))),
      shelter.validationReason ? h("dt", {}, "Motivo") : null,
      shelter.validationReason ? h("dd", {}, shelter.validationReason) : null,
    ),
    actions,
  );
}

/** CU-39 · /admin/protectoras: validate (also again, T-45), reject and revoke shelters. */
export async function renderAdminShelters(root: HTMLElement): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }
  if (user.role !== "ADMIN") {
    navigate("/inicio", { replace: true });
    return;
  }

  const status = currentStatus();
  const reload = () => void renderAdminShelters(root);
  const tabs = h(
    "nav",
    { class: "tabs", "aria-label": "Estado de validación" },
    ...TABS.map((tab) =>
      h(
        "a",
        { class: "tabs__tab", href: `/admin/protectoras?estado=${tab.status}`, "aria-current": tab.status === status ? "page" : undefined },
        tab.label,
      ),
    ),
  );

  let list: Node;
  try {
    const { shelters } = await listShelters(status);
    list =
      shelters.length === 0
        ? notice("info", "No hay protectoras en este estado.")
        : h("div", { class: "shelter-list" }, ...shelters.map((shelter) => shelterCard(shelter, reload)));
  } catch (error) {
    list = notice("error", error instanceof ApiError ? error.message : "No se han podido cargar las protectoras.");
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("p", { class: "overline" }, "Administración"),
      h("h1", { class: "display" }, "Protectoras"),
      h("p", { class: "muted" }, "Comprueba el CIF de cada protectora antes de validarla. Hasta entonces, sus mascotas no son visibles."),
      tabs,
      list,
    ]),
  );
}
