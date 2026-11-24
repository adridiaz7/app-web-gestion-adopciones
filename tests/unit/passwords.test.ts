import { describe, expect, it } from "vitest";
import { hashPassword } from "../../src/server/services/passwords.js";

describe("T-04 hashPassword()", () => {
  it("RN-08: stores an Argon2id hash, never the password itself", async () => {
    const hash = await hashPassword("una contraseña larga");

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("una contraseña larga");
  });

  it("RN-08: the same password gives a different hash each time (random salt)", async () => {
    expect(await hashPassword("una contraseña larga")).not.toBe(await hashPassword("una contraseña larga"));
  });
});
