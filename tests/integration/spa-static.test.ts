import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";

describe("T-09 serving the SPA from the same origin as the API", () => {
  it("T-09: serves index.html at the root", async () => {
    const res = await request(createApp()).get("/");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain('<div id="app"');
    expect(res.text).toContain('<html lang="es">');
  });

  it("T-09: answers any other page route with index.html, for the History API router", async () => {
    const res = await request(createApp()).get("/iniciar-sesion");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain('<div id="app"');
  });

  it("T-09: serves the CSS with the design system tokens", async () => {
    const res = await request(createApp()).get("/styles/tokens.css");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/css/);
    expect(res.text).toContain("--color-primary: var(--primary-300);");
  });

  it("T-09: an unknown /api route is still a JSON 404, not the page", async () => {
    const res = await request(createApp()).get("/api/no-existe");

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("T-09: a missing file with an extension is a 404, not the page", async () => {
    const res = await request(createApp()).get("/styles/no-existe.css");

    expect(res.status).toBe(404);
  });
});
