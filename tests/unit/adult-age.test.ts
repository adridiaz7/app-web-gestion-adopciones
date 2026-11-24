import { describe, expect, it } from "vitest";
import { isAdult } from "../../src/server/services/registration.js";

describe("T-04 isAdult()", () => {
  const today = "2026-11-24";

  it("RN-25: someone who turns 18 today is an adult", () => {
    expect(isAdult("2008-11-24", today)).toBe(true);
  });

  it("RN-25: someone who turns 18 tomorrow is still a minor", () => {
    expect(isAdult("2008-11-25", today)).toBe(false);
  });

  it("RN-25: an adult born well before is an adult", () => {
    expect(isAdult("1990-01-01", today)).toBe(true);
  });

  it("RN-25: a birth date in the future is not an adult", () => {
    expect(isAdult("2027-01-01", today)).toBe(false);
  });

  it("RN-25: someone born on 29 February becomes an adult on 1 March of a non-leap year", () => {
    expect(isAdult("2008-02-29", "2026-02-28")).toBe(false);
    expect(isAdult("2008-02-29", "2026-03-01")).toBe(true);
  });
});
