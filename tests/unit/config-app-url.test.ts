import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/server/config.js";

const minimalEnv = { DATABASE_URL: "postgres://postgres@localhost:5432/lagun" };

describe("T-04 config: public URL of the app (links in the emails)", () => {
  it("defaults to localhost on the configured port", () => {
    expect(loadConfig(minimalEnv).appUrl).toBe("http://localhost:3000");
    expect(loadConfig({ ...minimalEnv, PORT: "8080" }).appUrl).toBe("http://localhost:8080");
  });

  it("reads APP_URL without its trailing slash", () => {
    expect(loadConfig({ ...minimalEnv, APP_URL: "https://lagun.example/" }).appUrl).toBe("https://lagun.example");
  });

  it("fails when APP_URL is not an http(s) URL", () => {
    expect(() => loadConfig({ ...minimalEnv, APP_URL: "lagun" })).toThrow(/APP_URL/);
  });
});
