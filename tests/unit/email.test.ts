import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { sendEmail } from "../../src/server/services/email.js";

describe("T-03 simulated email", () => {
  let consoleInfo: MockInstance<typeof console.info>;

  beforeEach(() => {
    consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleInfo.mockRestore();
  });

  it("writes the recipient, subject and text (with its link) to the server console instead of sending it", async () => {
    await sendEmail({
      to: "ane@example.test",
      subject: "Verifica tu email",
      text: "Pulsa este enlace: http://localhost:3000/verificar-email?token=abc123",
    });

    const printed = consoleInfo.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(printed).toContain("ane@example.test");
    expect(printed).toContain("Verifica tu email");
    expect(printed).toContain("http://localhost:3000/verificar-email?token=abc123");
  });
});
