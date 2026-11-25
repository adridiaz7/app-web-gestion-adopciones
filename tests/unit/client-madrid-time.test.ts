import { describe, expect, it } from "vitest";
import { madridDate, madridTime, madridToIso } from "../../src/client/madrid-time.js";

describe("T-20 client: Madrid local times for the slots", () => {
  it("RN-78: a winter date and time in Madrid is UTC+1", () => {
    expect(madridToIso("2026-12-03", "10:30")).toBe("2026-12-03T09:30:00.000Z");
  });

  it("RN-78: a summer date and time in Madrid is UTC+2", () => {
    expect(madridToIso("2027-07-15", "18:00")).toBe("2027-07-15T16:00:00.000Z");
  });

  it("RN-78: shows an instant as Madrid date and time, for the edit form", () => {
    expect(madridDate("2026-12-03T23:30:00.000Z")).toBe("2026-12-04");
    expect(madridTime("2026-12-03T23:30:00.000Z")).toBe("00:30");
  });
});
