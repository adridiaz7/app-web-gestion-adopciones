import { describe, expect, it } from "vitest";
import { emptyValues } from "../../src/server/services/account-deletion.js";

describe("T-37 RN-210: emptying the values of an audit entry", () => {
  it("RN-210: keeps every key, at any depth, and empties the values", () => {
    expect(emptyValues({ before: { phone: "600", household: { members: 3 } }, after: { phone: "611", tags: ["a"] } })).toEqual({
      before: { phone: null, household: { members: null } },
      after: { phone: null, tags: null },
    });
  });

  it("RN-210: an empty object stays empty", () => {
    expect(emptyValues({})).toEqual({});
  });
});
