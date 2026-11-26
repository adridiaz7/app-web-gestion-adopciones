import type { AdopterBlock, BlockReason } from "../../shared/api.js";
import { blockAdopter, getAdopterBlock, unblockAdopter } from "../api/blocks.js";
import { ApiError } from "../api/client.js";
import { h } from "../dom.js";
import { onSubmit, selectField, submitButton, textValue } from "./form.js";
import { notice } from "./notice.js";

/** RN-147: the internal reasons, as the shelter reads them. */
const REASONS: Record<BlockReason, string> = {
  INAPPROPRIATE_BEHAVIOUR: "Comportamiento inadecuado",
  FALSE_INFORMATION: "Información falsa",
  BREACHES: "Incumplimientos",
  OTHER: "Otro",
};

const isReason = (value: string): value is BlockReason => value in REASONS;
const DAY = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long", year: "numeric" });

/**
 * CU-35 · block section of an adopter's page in the shelter's area: shows the active block
 * and lets the shelter lift it, or block the adopter with an internal reason.
 */
export function adopterBlockSection(adopterId: number, adopterName: string): HTMLElement {
  const section = h("section", { class: "card form" }, h("h2", {}, "Bloqueo"), h("p", { class: "muted" }, "Cargando…"));

  const render = (block: AdopterBlock | null, message: HTMLElement | null = null): void => {
    if (block) {
      const until = block.endsAt ? `hasta el ${DAY.format(new Date(block.endsAt))}` : "de forma definitiva";
      const lift = h("button", { type: "button", class: "button button--secondary" }, "Desbloquear");
      lift.addEventListener("click", () => {
        lift.disabled = true;
        unblockAdopter(adopterId)
          .then(() => {
            render(null, notice("success", `Has desbloqueado a ${adopterName}.`));
          })
          .catch((error: unknown) => {
            render(block, notice("error", error instanceof ApiError ? error.message : "No se ha podido desbloquear."));
          });
      });
      section.replaceChildren(
        h("h2", {}, "Bloqueo"),
        message ?? "",
        notice("warning", `Has bloqueado a este adoptante ${until}.`, `Motivo interno: ${REASONS[block.reason]}${block.detail ? ` · ${block.detail}` : ""}. El adoptante no lo ve.`),
        lift,
      );
      return;
    }

    const detail = h("textarea", { id: "field-detail", name: "detail", rows: "3", maxlength: "1000" });
    const form = h(
      "form",
      { class: "form" },
      selectField(
        "reason",
        "Motivo (interno: el adoptante no lo verá)",
        Object.entries(REASONS).map(([value, label]) => ({ value, label })),
      ),
      h("div", { class: "field", "data-field": "detail" }, h("label", { for: "field-detail" }, "Detalle (opcional)"), detail, h("p", { class: "field__error" })),
      submitButton("Bloquear"),
    );
    onSubmit(form, async () => {
      const reason = textValue(form, "reason");
      if (!isReason(reason)) throw new ApiError(400, "Elige el motivo del bloqueo.", { reason: "Elige el motivo del bloqueo." });
      if (!window.confirm(`¿Seguro que quieres bloquear a ${adopterName}? Se anularán sus visitas y solicitudes con tu protectora.`)) return;
      const { block: created } = await blockAdopter(adopterId, { reason, detail: textValue(form, "detail") || null });
      render(created, notice("success", `Has bloqueado a ${adopterName}.`));
    });
    section.replaceChildren(
      h("h2", {}, "Bloqueo"),
      message ?? "",
      h(
        "p",
        { class: "muted" },
        "Al bloquearlo, dejará de ver tus mascotas y no podrá pedirte visitas, adopciones ni escribirte. Se anulan sus visitas y solicitudes pendientes. El primer bloqueo dura unos días; los siguientes son definitivos.",
      ),
      form,
    );
  };

  getAdopterBlock(adopterId)
    .then(({ block }) => {
      render(block);
    })
    .catch((error: unknown) => {
      section.replaceChildren(h("h2", {}, "Bloqueo"), notice("error", error instanceof ApiError ? error.message : "No se ha podido cargar el bloqueo."));
    });
  return section;
}
