import { describe, expect, it } from "vitest";
import { blockNoticeText } from "../../src/client/block-notice.js";

describe("T-16 client: restricted-access notice", () => {
  it("RN-149: a permanent block gives a neutral text without an end date", () => {
    expect(blockNoticeText("Huellas", null)).toBe("La protectora Huellas ha restringido tu acceso a sus mascotas.");
  });

  it("RN-149: a temporary block says until when, in Madrid time", () => {
    expect(blockNoticeText("Huellas", "2026-12-10T23:30:00.000Z")).toBe(
      "La protectora Huellas ha restringido tu acceso a sus mascotas hasta el 11 de diciembre de 2026.",
    );
  });
});
