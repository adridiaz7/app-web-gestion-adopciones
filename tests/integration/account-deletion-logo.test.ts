import { existsSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getConfig } from "../../src/server/config.js";
import { getPool } from "../../src/server/db/pool.js";
import { hashPassword } from "../../src/server/services/passwords.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createShelter, type CreatedUser } from "../helpers/factories.js";

const PASSWORD = "contraseña-de-prueba";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
let passwordHash: string;
let shelter: CreatedUser;
let cookie: string;

const fileOf = (url: string): string => join(getConfig().uploadsDir, url.slice("/uploads/".length));
const remove = (password: string) => request(createApp()).post("/api/auth/delete-account").set("Cookie", cookie).send({ password });

async function uploadLogo(): Promise<string> {
  const res = await request(createApp()).post("/api/shelter/profile/logo").set("Cookie", cookie).attach("logo", PNG, "logo.png");
  expect(res.status).toBe(200);
  return res.body.profile.logoUrl as string;
}

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter({ name: "Huellas", passwordHash });
  cookie = await sessionCookie(shelter.id);
});

describe("T-54 CU-07: the logo file of a deleted shelter", () => {
  it("CU-07, RN-12: deleting a shelter with a logo removes its file from uploads", async () => {
    const url = await uploadLogo();
    expect(existsSync(fileOf(url))).toBe(true);

    expect((await remove(PASSWORD)).status).toBe(204);

    expect(existsSync(fileOf(url))).toBe(false);
    const { rows } = await getPool().query<{ logo_path: string | null }>(`SELECT logo_path FROM "Shelter" WHERE user_id = $1`, [shelter.id]);
    expect(rows[0]?.logo_path).toBeNull();
  });

  it("CU-07, RN-171: if the deletion is not committed, the logo file stays", async () => {
    const url = await uploadLogo();

    expect((await remove("otra-contraseña")).status).toBe(400);

    expect(existsSync(fileOf(url))).toBe(true);
  });
});
