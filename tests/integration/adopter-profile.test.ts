import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createAdopter, createShelter, type CreatedUser } from "../helpers/factories.js";

const URL = "/api/adopter/profile";

let adopter: CreatedUser;
let cookie: string;

const EMPTY_HOUSEHOLD = {
  housingType: null,
  hasOutdoorSpace: null,
  housingTenure: null,
  householdMembers: null,
  hasChildren: null,
  hasOtherPets: null,
  otherPetsDescription: null,
  hasPetExperience: null,
  hoursAlonePerDay: null,
};

const FULL_HOUSEHOLD = {
  housingType: "HOUSE",
  hasOutdoorSpace: true,
  housingTenure: "RENT_TO_OWN",
  householdMembers: 3,
  hasChildren: true,
  hasOtherPets: true,
  otherPetsDescription: "Un gato",
  hasPetExperience: false,
  hoursAlonePerDay: 4,
};

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstName: "Miren",
    lastName: "Agirre",
    phone: "611 222 333",
    birthDate: "1985-06-15",
    provinceId: 48,
    locality: "Bilbao",
    household: FULL_HOUSEHOLD,
    ...overrides,
  };
}

const getProfile = (as = cookie) => request(createApp()).get(URL).set("Cookie", as);
const putProfile = (body: unknown, as = cookie) => request(createApp()).put(URL).set("Cookie", as).send(body as object);

async function adopterRow(): Promise<Record<string, unknown>> {
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT first_name, last_name, phone, to_char(birth_date, 'YYYY-MM-DD') AS birth_date, province_id, locality,
            housing_type, housing_tenure, household_members, hours_alone_per_day
       FROM "Adopter" WHERE user_id = $1`,
    [adopter.id],
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
  adopter = await createAdopter({ email: "ane@example.test", firstName: "Ane", lastName: "Etxeberria", birthDate: "1990-01-01", provinceId: 20 });
  cookie = await sessionCookie(adopter.id);
});

describe("T-36 CU-06 GET /api/adopter/profile", () => {
  it("CU-06: returns the adopter's personal data and the household data (empty until filled in)", async () => {
    const res = await getProfile();

    expect(res.status).toBe(200);
    expect(res.body.profile).toEqual({
      email: "ane@example.test",
      firstName: "Ane",
      lastName: "Etxeberria",
      phone: "600000000",
      birthDate: "1990-01-01",
      provinceId: 20,
      locality: "Donostia",
      household: EMPTY_HOUSEHOLD,
    });
  });
});

describe("T-36 CU-06 PUT /api/adopter/profile", () => {
  it("CU-06, RN-27: saves the personal data and the household data, including RENT_TO_OWN", async () => {
    const res = await putProfile(validBody());

    expect(res.status).toBe(200);
    expect(res.body.profile).toEqual({
      email: "ane@example.test",
      firstName: "Miren",
      lastName: "Agirre",
      phone: "611222333",
      birthDate: "1985-06-15",
      provinceId: 48,
      locality: "Bilbao",
      household: FULL_HOUSEHOLD,
    });
    expect(await adopterRow()).toEqual({
      first_name: "Miren",
      last_name: "Agirre",
      phone: "611222333",
      birth_date: "1985-06-15",
      province_id: 48,
      locality: "Bilbao",
      housing_type: "HOUSE",
      housing_tenure: "RENT_TO_OWN",
      household_members: 3,
      hours_alone_per_day: 4,
    });
  });

  it("RN-27: the household data are optional in the profile and can be left empty", async () => {
    const res = await putProfile(validBody({ household: { ...EMPTY_HOUSEHOLD, housingType: "APARTMENT" } }));

    expect(res.status).toBe(200);
    expect(res.body.profile.household).toEqual({ ...EMPTY_HOUSEHOLD, housingType: "APARTMENT" });
  });

  it("RN-208: the edit is audited with the old and new values of only the fields that change", async () => {
    expect((await putProfile(validBody({ firstName: "Ane", lastName: "Etxeberria", phone: "600000000", birthDate: "1990-01-01", provinceId: 20, locality: "Donostia", household: { ...EMPTY_HOUSEHOLD, hoursAlonePerDay: 2 } }))).status).toBe(200);

    expect(await profileAudits()).toEqual([
      {
        actor_user_id: adopter.id,
        entity_type: "Adopter",
        entity_id: adopter.id,
        details: { before: { hoursAlonePerDay: null }, after: { hoursAlonePerDay: 2 } },
      },
    ]);
  });

  it("RN-208: saving without changes writes no audit entry", async () => {
    expect((await putProfile(validBody())).status).toBe(200);
    expect((await putProfile(validBody())).status).toBe(200);

    expect(await profileAudits()).toHaveLength(1);
  });

  it("CU-06, RN-25: rejects a new birth date of a minor and changes nothing", async () => {
    const year = new Date().getFullYear() - 17;
    const res = await putProfile(validBody({ birthDate: `${String(year)}-01-01` }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mayor de edad/);
    expect((await adopterRow())["first_name"]).toBe("Ane");
    expect(await profileAudits()).toEqual([]);
  });

  it("CU-06: rejects data with a wrong format and changes nothing", async () => {
    const wrong = [
      validBody({ phone: "12345" }),
      validBody({ firstName: "  " }),
      validBody({ birthDate: "15/06/1985" }),
      validBody({ provinceId: "Bizkaia" }),
      validBody({ household: { ...FULL_HOUSEHOLD, hoursAlonePerDay: 25 } }),
      validBody({ household: { ...FULL_HOUSEHOLD, housingTenure: "BORROWED" } }),
      validBody({ household: { ...FULL_HOUSEHOLD, householdMembers: 0 } }),
    ];
    for (const body of wrong) {
      const res = await putProfile(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await adopterRow())["first_name"]).toBe("Ane");
  });

  it("CU-06: rejects a province that does not exist", async () => {
    const res = await putProfile(validBody({ provinceId: 99 }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("La provincia no existe.");
  });

  it("CU-06: the email cannot be changed here (CU-49)", async () => {
    const res = await putProfile(validBody({ email: "otro@example.test" }));

    expect(res.status).toBe(200);
    expect(res.body.profile.email).toBe("ane@example.test");
  });
});

describe("T-36 CU-06 adopter profile permissions", () => {
  it("CU-06: a session is required and only adopters use it", async () => {
    const shelterCookie = await sessionCookie((await createShelter()).id);
    const adminCookie = await sessionCookie((await createAdmin()).id);

    expect((await request(createApp()).get(URL)).status).toBe(401);
    expect((await request(createApp()).put(URL).send(validBody())).status).toBe(401);
    for (const other of [shelterCookie, adminCookie]) {
      expect((await getProfile(other)).status).toBe(403);
      expect((await putProfile(validBody(), other)).status).toBe(403);
    }
    expect((await adopterRow())["first_name"]).toBe("Ane");
  });
});
