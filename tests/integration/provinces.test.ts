import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";

describe("T-09 GET /api/provinces", () => {
  it("T-09: lists the 52 provinces, sorted by name, without a session (needed to sign up)", async () => {
    const res = await request(createApp()).get("/api/provinces");

    expect(res.status).toBe(200);
    expect(res.body.provinces).toHaveLength(52);
    expect(res.body.provinces).toContainEqual({ id: 20, name: "Gipuzkoa" });
    const names = (res.body.provinces as { name: string }[]).map((p) => p.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "es")));
  });
});
