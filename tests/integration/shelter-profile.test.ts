import { existsSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getConfig } from "../../src/server/config.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createAdopter, createShelter, type CreatedUser } from "../helpers/factories.js";

const URL = "/api/shelter/profile";
const LOGO_URL = "/api/shelter/profile/logo";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);

let shelter: CreatedUser;
let cookie: string;

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    description: "Protectora de perros y gatos en Bilbao.",
    address: "Calle Mayor 5",
    provinceId: 48,
    locality: "Bilbao",
    phone: "944 111 222",
    contactEmail: "Hola@Protectora.test",
    website: "https://protectora.test",
    openingHours: "L-V de 10:00 a 14:00",
    ...overrides,
  };
}

const getProfile = (as = cookie) => request(createApp()).get(URL).set("Cookie", as);
const putProfile = (body: unknown, as = cookie) => request(createApp()).put(URL).set("Cookie", as).send(body as object);
const uploadLogo = (file: Buffer, as = cookie) => request(createApp()).post(LOGO_URL).set("Cookie", as).attach("logo", file, "logo.png");
const fileOf = (url: string) => join(getConfig().uploadsDir, url.replace(/^\/uploads\//, ""));

async function shelterRow(): Promise<Record<string, unknown>> {
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT name, cif, description, logo_path, address, province_id, locality, phone, contact_email, website, opening_hours
       FROM "Shelter" WHERE user_id = $1`,
    [shelter.id],
  );
  return rows[0] ?? {};
}

async function profileAudits(): Promise<{ actor_user_id: number; entity_type: string; entity_id: number; details: unknown }[]> {
  const { rows } = await getPool().query<{ actor_user_id: number; entity_type: string; entity_id: number; details: unknown }>(
    `SELECT actor_user_id, entity_type, entity_id, details FROM "Audit_log" WHERE action = 'PROFILE_UPDATED' ORDER BY id`,
  );
  return rows;
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter({ email: "refugio@example.test", name: "Refugio Txuri", cif: "G12345678", provinceId: 20 });
  cookie = await sessionCookie(shelter.id);
});

describe("T-36 CU-06 GET /api/shelter/profile", () => {
  it("CU-06: returns the shelter's data, with the public ones still empty", async () => {
    const res = await getProfile();

    expect(res.status).toBe(200);
    expect(res.body.profile).toEqual({
      email: "refugio@example.test",
      name: "Refugio Txuri",
      cif: "G12345678",
      description: null,
      logoUrl: null,
      address: "Calle Falsa 1",
      provinceId: 20,
      locality: "Donostia",
      phone: "943000000",
      contactEmail: null,
      website: null,
      openingHours: null,
    });
  });
});

describe("T-36 CU-06 PUT /api/shelter/profile", () => {
  it("CU-06: saves the public data (description, address, phone, contact email, website and opening hours)", async () => {
    const res = await putProfile(validBody());

    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({
      name: "Refugio Txuri",
      cif: "G12345678",
      description: "Protectora de perros y gatos en Bilbao.",
      address: "Calle Mayor 5",
      provinceId: 48,
      locality: "Bilbao",
      phone: "944111222",
      contactEmail: "hola@protectora.test",
      website: "https://protectora.test",
      openingHours: "L-V de 10:00 a 14:00",
    });
    expect(await shelterRow()).toMatchObject({ description: "Protectora de perros y gatos en Bilbao.", province_id: 48, contact_email: "hola@protectora.test" });
  });

  it("CU-06: the optional public data can be left empty", async () => {
    await putProfile(validBody());

    const res = await putProfile(validBody({ description: "", contactEmail: null, website: "", openingHours: null }));

    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ description: null, contactEmail: null, website: null, openingHours: null });
  });

  it("CU-06: the name and the CIF are not changed from the profile", async () => {
    const res = await putProfile(validBody({ name: "Otro nombre", cif: "B87654321" }));

    expect(res.status).toBe(200);
    expect(await shelterRow()).toMatchObject({ name: "Refugio Txuri", cif: "G12345678" });
  });

  it("RN-208: the edit is audited with the old and new values of only the fields that change", async () => {
    const res = await putProfile({ description: "Nueva", address: "Calle Falsa 1", provinceId: 20, locality: "Donostia", phone: "943000000", contactEmail: null, website: null, openingHours: null });

    expect(res.status).toBe(200);
    expect(await profileAudits()).toEqual([
      { actor_user_id: shelter.id, entity_type: "Shelter", entity_id: shelter.id, details: { before: { description: null }, after: { description: "Nueva" } } },
    ]);
  });

  it("RN-208: saving without changes writes no audit entry", async () => {
    await putProfile(validBody());
    await putProfile(validBody());

    expect(await profileAudits()).toHaveLength(1);
  });

  it("CU-06: rejects data with a wrong format and changes nothing", async () => {
    const wrong = [
      validBody({ phone: "123" }),
      validBody({ contactEmail: "no-es-un-email" }),
      validBody({ website: "protectora" }),
      validBody({ website: "javascript:alert(1)" }),
      validBody({ address: " " }),
      validBody({ provinceId: 0 }),
    ];
    for (const body of wrong) {
      const res = await putProfile(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await shelterRow())["address"]).toBe("Calle Falsa 1");
  });

  it("CU-06: rejects a province that does not exist", async () => {
    const res = await putProfile(validBody({ provinceId: 99 }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("La provincia no existe.");
  });

  it("CU-13: the public data edited show in the shelter's public profile", async () => {
    await putProfile(validBody());
    const adopterCookie = await sessionCookie((await createAdopter()).id);

    const res = await request(createApp()).get(`/api/shelters/${String(shelter.id)}`).set("Cookie", adopterCookie);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain("Protectora de perros y gatos en Bilbao.");
  });
});

describe("T-36 CU-06 POST and DELETE /api/shelter/profile/logo", () => {
  it("CU-06, RN-52: uploads the logo with a random name and stores only its path", async () => {
    const res = await uploadLogo(PNG);

    expect(res.status).toBe(200);
    const url = res.body.profile.logoUrl as string;
    expect(url).toMatch(/^\/uploads\/[\w-]+\.png$/);
    expect((await shelterRow())["logo_path"]).toBe(url);
    expect(existsSync(fileOf(url))).toBe(true);
  });

  it("CU-06: a new logo replaces the old one and deletes its file", async () => {
    const first = (await uploadLogo(PNG)).body.profile.logoUrl as string;

    const res = await uploadLogo(JPEG);

    expect(res.status).toBe(200);
    const second = res.body.profile.logoUrl as string;
    expect(second).toMatch(/\.jpg$/);
    expect(existsSync(fileOf(first))).toBe(false);
    expect(existsSync(fileOf(second))).toBe(true);
  });

  it("CU-06: rejects a file that is not a JPEG, PNG or WebP image, judged by its content", async () => {
    const res = await uploadLogo(Buffer.from("esto no es una imagen"));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JPEG, PNG o WebP/);
    expect((await shelterRow())["logo_path"]).toBeNull();
  });

  it("CU-06: rejects a request without a file", async () => {
    const res = await request(createApp()).post(LOGO_URL).set("Cookie", cookie);

    expect(res.status).toBe(400);
  });

  it("CU-06: deletes the logo and its file", async () => {
    const url = (await uploadLogo(PNG)).body.profile.logoUrl as string;

    const res = await request(createApp()).delete(LOGO_URL).set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.profile.logoUrl).toBeNull();
    expect((await shelterRow())["logo_path"]).toBeNull();
    expect(existsSync(fileOf(url))).toBe(false);
  });

  it("RN-208: changing and deleting the logo are audited with the old and new paths", async () => {
    const url = (await uploadLogo(PNG)).body.profile.logoUrl as string;
    await request(createApp()).delete(LOGO_URL).set("Cookie", cookie);

    expect(await profileAudits()).toEqual([
      { actor_user_id: shelter.id, entity_type: "Shelter", entity_id: shelter.id, details: { before: { logoUrl: null }, after: { logoUrl: url } } },
      { actor_user_id: shelter.id, entity_type: "Shelter", entity_id: shelter.id, details: { before: { logoUrl: url }, after: { logoUrl: null } } },
    ]);
  });
});

describe("T-36 CU-06 shelter profile permissions", () => {
  it("CU-06: a session is required and only shelters use it", async () => {
    const adopterCookie = await sessionCookie((await createAdopter()).id);
    const adminCookie = await sessionCookie((await createAdmin()).id);

    expect((await request(createApp()).get(URL)).status).toBe(401);
    expect((await request(createApp()).put(URL).send(validBody())).status).toBe(401);
    expect((await request(createApp()).post(LOGO_URL).attach("logo", PNG, "logo.png")).status).toBe(401);
    expect((await request(createApp()).delete(LOGO_URL)).status).toBe(401);
    for (const other of [adopterCookie, adminCookie]) {
      expect((await getProfile(other)).status).toBe(403);
      expect((await putProfile(validBody(), other)).status).toBe(403);
      expect((await uploadLogo(PNG, other)).status).toBe(403);
      expect((await request(createApp()).delete(LOGO_URL).set("Cookie", other)).status).toBe(403);
    }
    expect(await shelterRow()).toMatchObject({ address: "Calle Falsa 1", logo_path: null });
  });
});
