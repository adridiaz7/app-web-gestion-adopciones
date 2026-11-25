import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, type CreatedUser } from "../helpers/factories.js";

interface ShelterCardBody {
  id: number;
  name: string;
  availablePets: number;
}

let adopter: CreatedUser;
let cookie: string;

async function search(query = "", as: string = cookie): Promise<ShelterCardBody[]> {
  const res = await request(createApp()).get(`/api/shelters${query}`).set("Cookie", as);
  expect(res.status).toBe(200);
  return res.body.shelters as ShelterCardBody[];
}

const names = (cards: ShelterCardBody[]) => cards.map((c) => c.name).sort();

const profile = (id: number, as: string | null = cookie) => {
  const req = request(createApp()).get(`/api/shelters/${String(id)}`);
  return as ? req.set("Cookie", as) : req;
};

async function block(shelterId: number, adopterId: number, endsAt: string | null = null): Promise<void> {
  await getPool().query(`INSERT INTO "Block" (shelter_id, adopter_id, reason, ends_at) VALUES ($1, $2, 'OTHER', $3)`, [
    shelterId,
    adopterId,
    endsAt,
  ]);
}

beforeEach(async () => {
  await truncateAll();
  adopter = await createAdopter();
  cookie = await sessionCookie(adopter.id);
});

describe("T-16 CU-13 GET /api/shelters", () => {
  it("CU-13: lists the shelters with their public data and number of available pets", async () => {
    const shelter = await createShelter({ name: "Huellas", provinceId: 46 });
    await getPool().query(`UPDATE "Shelter" SET description = 'Rescatamos perros.' WHERE user_id = $1`, [shelter.id]);
    await createPet({ shelterId: shelter.id });
    await createPet({ shelterId: shelter.id });
    const reserved = await createPet({ shelterId: shelter.id });
    await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [reserved.id]);

    const res = await request(createApp()).get("/api/shelters").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.shelters).toEqual([
      {
        id: shelter.id,
        name: "Huellas",
        description: "Rescatamos perros.",
        logoUrl: null,
        locality: "Donostia",
        provinceName: "Valencia/València",
        availablePets: 2,
      },
    ]);
  });

  it("RN-69: filters by province", async () => {
    await createShelter({ name: "Valencia", provinceId: 46 });
    await createShelter({ name: "Gipuzkoa", provinceId: 20 });
    expect(names(await search("?provinceId=20"))).toEqual(["Gipuzkoa"]);
  });

  it("CU-13: searches by name, ignoring case", async () => {
    await createShelter({ name: "Protectora Huellas de Valencia" });
    await createShelter({ name: "Bigotes Libres" });
    expect(names(await search("?name=huellas"))).toEqual(["Protectora Huellas de Valencia"]);
  });

  it("CU-13: the name search treats % and _ as plain text", async () => {
    await createShelter({ name: "Huellas" });
    expect(await search("?name=%25")).toEqual([]);
    expect(await search("?name=_")).toEqual([]);
  });

  it("CU-13: no shelters match the filters: an empty list", async () => {
    await createShelter({ provinceId: 46 });
    expect(await search("?provinceId=20")).toEqual([]);
  });

  it("RN-24, CU-13: hides the shelters that are not validated, are suspended or were deleted", async () => {
    await createShelter({ name: "Validada" });
    await createShelter({ name: "Pendiente", validationStatus: "PENDING" });
    await createShelter({ name: "Rechazada", validationStatus: "REJECTED" });
    const suspended = await createShelter({ name: "Suspendida" });
    await getPool().query(`INSERT INTO "Suspension" (user_id, reason) VALUES ($1, 'OTHER')`, [suspended.id]);
    const deleted = await createShelter({ name: "Eliminada" });
    await getPool().query(`UPDATE "App_user" SET deleted_at = now() WHERE id = $1`, [deleted.id]);
    expect(names(await search())).toEqual(["Validada"]);
  });

  it("RN-77: a shelter that blocked the adopter still appears, with no pets to show", async () => {
    const shelter = await createShelter({ name: "Bloqueante" });
    await createPet({ shelterId: shelter.id });
    await block(shelter.id, adopter.id);
    expect(await search()).toEqual([expect.objectContaining({ name: "Bloqueante", availablePets: 0 })]);
  });

  it("RN-187: a visitor without a session cannot search shelters", async () => {
    const res = await request(createApp()).get("/api/shelters");
    expect(res.status).toBe(401);
  });

  it("CU-13: rejects malformed filters with 400", async () => {
    for (const query of ["?provinceId=abc", "?provinceId=99999", `?name=${"a".repeat(101)}`]) {
      const res = await request(createApp()).get(`/api/shelters${query}`).set("Cookie", cookie);
      expect(res.status, query).toBe(400);
    }
  });
});

describe("T-16 CU-13 GET /api/shelters/:id", () => {
  it("CU-13: shows the shelter's public profile and its available pets", async () => {
    const shelter = await createShelter({ name: "Huellas", provinceId: 46 });
    await getPool().query(
      `UPDATE "Shelter" SET description = 'Rescatamos perros.', contact_email = 'info@huellas.test', website = 'huellas.test',
                            opening_hours = 'L-V 10-14' WHERE user_id = $1`,
      [shelter.id],
    );
    const pet = await createPet({ shelterId: shelter.id, name: "Luna" });
    const adopted = await createPet({ shelterId: shelter.id, name: "Adoptada" });
    await getPool().query(`UPDATE "Pet" SET status = 'ADOPTED' WHERE id = $1`, [adopted.id]);

    const res = await profile(shelter.id);
    expect(res.status).toBe(200);
    expect(res.body.shelter).toEqual({
      id: shelter.id,
      name: "Huellas",
      description: "Rescatamos perros.",
      logoUrl: null,
      address: "Calle Falsa 1",
      locality: "Donostia",
      provinceName: "Valencia/València",
      phone: "943000000",
      contactEmail: "info@huellas.test",
      website: "huellas.test",
      openingHours: "L-V 10-14",
    });
    expect(res.body.block).toBeNull();
    expect(res.body.pets).toEqual([expect.objectContaining({ id: pet.id, name: "Luna", shelterName: "Huellas" })]);
  });

  it("RN-149, CU-13: a permanent block shows the restricted-access notice and no pets", async () => {
    const shelter = await createShelter();
    await createPet({ shelterId: shelter.id });
    await block(shelter.id, adopter.id);

    const res = await profile(shelter.id);
    expect(res.status).toBe(200);
    expect(res.body.block).toEqual({ endsAt: null });
    expect(res.body.pets).toEqual([]);
  });

  it("RN-149: a temporary block says until when", async () => {
    const shelter = await createShelter();
    const endsAt = new Date(Date.now() + 15 * 24 * 3600 * 1000);
    await block(shelter.id, adopter.id, endsAt.toISOString());

    const res = await profile(shelter.id);
    expect(res.body.block).toEqual({ endsAt: endsAt.toISOString() });
  });

  it("RN-149: a lifted block no longer restricts anything", async () => {
    const shelter = await createShelter();
    await createPet({ shelterId: shelter.id });
    await getPool().query(
      `INSERT INTO "Block" (shelter_id, adopter_id, reason, lifted_at, lifted_by) VALUES ($1, $2, 'OTHER', now(), 'SHELTER')`,
      [shelter.id, adopter.id],
    );
    const res = await profile(shelter.id);
    expect(res.body.block).toBeNull();
    expect(res.body.pets).toHaveLength(1);
  });

  it("RN-24, CU-13: the profile of a shelter that is not validated or is suspended is not available", async () => {
    const pending = await createShelter({ validationStatus: "PENDING" });
    const suspended = await createShelter();
    await getPool().query(`INSERT INTO "Suspension" (user_id, reason) VALUES ($1, 'OTHER')`, [suspended.id]);
    for (const id of [pending.id, suspended.id, suspended.id + 1000]) {
      const res = await profile(id);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Esta protectora no está disponible.");
    }
  });

  it("RN-187: a visitor without a session cannot see a shelter's profile", async () => {
    const shelter = await createShelter();
    const res = await profile(shelter.id, null);
    expect(res.status).toBe(401);
  });
});
