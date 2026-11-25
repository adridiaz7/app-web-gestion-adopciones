import { describe, expect, it } from "vitest";
import { notificationHref } from "../../src/client/notification-link.js";

describe("T-28 CU-34 notificationHref", () => {
  it("CU-34, RN-142: a visit opens the adopter's visits or the shelter's requests", () => {
    expect(notificationHref({ visitId: 3 }, "ADOPTER")).toBe("/visitas");
    expect(notificationHref({ visitId: 3 }, "SHELTER")).toBe("/protectora/solicitudes");
  });

  it("CU-34, RN-142: a pet opens its profile for the adopter, or its form for the shelter", () => {
    expect(notificationHref({ petId: 7 }, "ADOPTER")).toBe("/mascotas/7");
    expect(notificationHref({ petId: 7 }, "SHELTER")).toBe("/protectora/mascotas/7");
  });

  it("CU-34: no link, or a link to a screen that does not exist yet, opens nothing", () => {
    expect(notificationHref(null, "ADOPTER")).toBeNull();
    expect(notificationHref({ adoptionId: 1 }, "ADOPTER")).toBeNull();
    expect(notificationHref({ incidentId: 1 }, "ADMIN")).toBeNull();
    expect(notificationHref({ visitId: 1 }, "ADMIN")).toBeNull();
  });
});
