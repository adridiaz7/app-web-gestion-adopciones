import { describe, expect, it } from "vitest";
import { ageLabel } from "../../src/client/age.js";

const today = new Date(2026, 10, 25); // 25 November 2026, local time

describe("T-12 RN-205: age shown in months under a year and in years from then on", () => {
  it("RN-205: under a year, in months", () => {
    expect(ageLabel("2026-01-25", today)).toBe("10 meses");
    expect(ageLabel("2026-10-25", today)).toBe("1 mes");
    expect(ageLabel("2026-11-01", today)).toBe("0 meses");
  });

  it("RN-205: a month is only counted once its day has come", () => {
    expect(ageLabel("2026-01-26", today)).toBe("9 meses");
  });

  it("RN-205: from a year on, in whole years", () => {
    expect(ageLabel("2025-11-25", today)).toBe("1 año");
    expect(ageLabel("2024-11-26", today)).toBe("1 año");
    expect(ageLabel("2019-03-02", today)).toBe("7 años");
  });
});
