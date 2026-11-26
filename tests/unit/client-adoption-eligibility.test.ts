import { describe, expect, it } from "vitest";
import { adoptionNoticeLink } from "../../src/client/adoption-eligibility.js";

describe("T-52 client: notice under the disabled 'Solicitar adopción' button", () => {
  it("RN-119: an open request links to the adopter's requests", () => {
    expect(adoptionNoticeLink("OPEN_REQUEST")).toEqual({ href: "/visitas", label: "Ver mi solicitud" });
  });

  it("RN-113, RN-116, RN-118: the other reasons have no link (the visit button is already in the profile)", () => {
    for (const reason of ["NO_VISIT", "VISIT_EXPIRED", "BLOCKED", "NO_SHOW", "NOT_AVAILABLE"] as const) {
      expect(adoptionNoticeLink(reason), reason).toBeNull();
    }
  });
});
