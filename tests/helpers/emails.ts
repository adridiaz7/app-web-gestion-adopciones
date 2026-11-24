import { afterEach, beforeEach, vi, type MockInstance } from "vitest";

/**
 * Captures the simulated emails (sendEmail writes them to console.info) in the tests of
 * the current file, and silences them. Returns a function with everything printed so far.
 */
export function captureEmails(): () => string {
  let consoleInfo: MockInstance<typeof console.info> | undefined;

  beforeEach(() => {
    consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleInfo?.mockRestore();
  });

  return () => (consoleInfo?.mock.calls ?? []).map((args) => args.join(" ")).join("\n");
}
