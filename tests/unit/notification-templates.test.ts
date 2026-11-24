import { describe, expect, it } from "vitest";
import { renderNotification } from "../../src/server/services/notification-templates.js";

// 10:30 in Madrid (CET, UTC+1) on 3 December 2026.
const startsAt = new Date("2026-12-03T09:30:00Z");

describe("T-03 notification templates", () => {
  it("RN-143: builds the title and body of a confirmed visit from its template", () => {
    expect(renderNotification("VISIT_CONFIRMED", { petName: "Txuri", startsAt })).toEqual({
      title: "Visita confirmada",
      body: "La protectora ha confirmado tu visita para conocer a Txuri el 3 de diciembre de 2026 a las 10:30.",
    });
  });

  it("RN-143: the rejected visit template adds the reason when the shelter gives one", () => {
    expect(renderNotification("VISIT_REJECTED", { petName: "Txuri", startsAt, reason: "Ese día no hay voluntarios." })).toEqual({
      title: "Visita rechazada",
      body:
        "La protectora ha rechazado tu solicitud de visita para conocer a Txuri el 3 de diciembre de 2026 a las 10:30. " +
        "Motivo: Ese día no hay voluntarios.",
    });
  });

  it("RN-143: the rejected visit template has no reason sentence when there is no reason", () => {
    expect(renderNotification("VISIT_REJECTED", { petName: "Txuri", startsAt, reason: null }).body).toBe(
      "La protectora ha rechazado tu solicitud de visita para conocer a Txuri el 3 de diciembre de 2026 a las 10:30.",
    );
  });

  it("shows dates in Spanish time (Europe/Madrid), also in summer time", () => {
    const summer = new Date("2026-07-15T16:00:00Z"); // 18:00 CEST
    expect(renderNotification("VISIT_CONFIRMED", { petName: "Beltza", startsAt: summer }).body).toContain(
      "el 15 de julio de 2026 a las 18:00",
    );
  });
});
