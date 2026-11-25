import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, type CreatedUser } from "../helpers/factories.js";

interface CardBody {
  id: number;
  name: string;
  speciesName: string;
  breedName: string;
  birthDate: string;
  sex: string;
  size: string;
  photoUrl: string | null;
  shelterName: string;
  provinceName: string;
}

let shelter: CreatedUser;

/** A date N months (and some extra days) before today, as YYYY-MM-DD. */
function monthsAgo(months: number, extraDays = 0): string {
  const date = new Date();
  date.setDate(1); // avoids month overflow (31st) when moving months
  date.setMonth(date.getMonth() - months);
  const day = Math.min(new Date().getDate(), new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate());
  date.setDate(day - extraDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function breedId(species: string, breed: string): Promise<number> {
  const { rows } = await getPool().query<{ id: number }>(
    `SELECT b.id FROM "Breed" b JOIN "Species" s ON s.id = b.species_id WHERE s.name = $1 AND b.name = $2`,
    [species, breed],
  );
  const row = rows[0];
  if (!row) throw new Error(`No breed ${breed}`);
  return row.id;
}

async function anyBreedOf(species: string): Promise<number> {
  const { rows } = await getPool().query<{ id: number }>(
    `SELECT min(b.id) AS id FROM "Breed" b JOIN "Species" s ON s.id = b.species_id WHERE s.name = $1`,
    [species],
  );
  const row = rows[0];
  if (!row) throw new Error(`No species ${species}`);
  return row.id;
}

async function speciesId(name: string): Promise<number> {
  const { rows } = await getPool().query<{ id: number }>(`SELECT id FROM "Species" WHERE name = $1`, [name]);
  const row = rows[0];
  if (!row) throw new Error(`No species ${name}`);
  return row.id;
}

async function gallery(query = "", cookie?: string): Promise<CardBody[]> {
  const req = request(createApp()).get(`/api/pets${query}`);
  const res = await (cookie ? req.set("Cookie", cookie) : req);
  expect(res.status).toBe(200);
  return res.body.pets as CardBody[];
}

const names = (cards: CardBody[]) => cards.map((c) => c.name).sort();

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter({ name: "Huellas", provinceId: 46 });
});

describe("T-14 CU-09 GET /api/pets", () => {
  it("RN-187: a visitor without a session sees the gallery cards", async () => {
    const pet = await createPet({ shelterId: shelter.id, name: "Luna", sex: "FEMALE", size: "MEDIUM", birthDate: "2022-01-01" });
    await getPool().query(`INSERT INTO "Pet_photo" (pet_id, path, position) VALUES ($1, '/uploads/b.png', 2), ($1, '/uploads/a.png', 1)`, [pet.id]);

    const [card] = await gallery();
    expect(card).toEqual({
      id: pet.id,
      name: "Luna",
      speciesName: expect.any(String),
      breedName: expect.any(String),
      birthDate: "2022-01-01",
      sex: "FEMALE",
      size: "MEDIUM",
      photoUrl: "/uploads/a.png",
      shelterName: "Huellas",
      provinceName: "Valencia/València",
    });
  });

  it("RN-51: a pet without photos has no main photo", async () => {
    await createPet({ shelterId: shelter.id });
    const [card] = await gallery();
    expect(card?.photoUrl).toBeNull();
  });

  it("CU-09: shows the newest pets first", async () => {
    const old = await createPet({ shelterId: shelter.id, name: "Antigua" });
    await getPool().query(`UPDATE "Pet" SET created_at = now() - interval '1 day' WHERE id = $1`, [old.id]);
    await createPet({ shelterId: shelter.id, name: "Nueva" });
    expect((await gallery()).map((c) => c.name)).toEqual(["Nueva", "Antigua"]);
  });

  it("RN-58: only available pets are shown", async () => {
    await createPet({ shelterId: shelter.id, name: "Disponible" });
    for (const status of ["RESERVED", "ADOPTED"]) {
      const pet = await createPet({ shelterId: shelter.id, name: status });
      await getPool().query(`UPDATE "Pet" SET status = $2 WHERE id = $1`, [pet.id, status]);
    }
    const unlisted = await createPet({ shelterId: shelter.id, name: "Baja" });
    await getPool().query(
      `UPDATE "Pet" SET status = 'UNLISTED', unlist_reason = 'OTHER', unlisted_at = now() WHERE id = $1`,
      [unlisted.id],
    );
    expect(names(await gallery())).toEqual(["Disponible"]);
  });

  it("CU-09, RN-23: hides the pets of shelters that are not validated", async () => {
    await createPet({ shelterId: shelter.id, name: "Validada" });
    for (const validationStatus of ["PENDING", "REJECTED"] as const) {
      const other = await createShelter({ validationStatus });
      await createPet({ shelterId: other.id, name: validationStatus });
    }
    expect(names(await gallery())).toEqual(["Validada"]);
  });

  it("CU-09, RN-23: hides the pets of a suspended shelter, and shows them again when the suspension ends", async () => {
    const other = await createShelter();
    await createPet({ shelterId: other.id, name: "Suspendida" });
    await createPet({ shelterId: shelter.id, name: "Activa" });
    await getPool().query(`INSERT INTO "Suspension" (user_id, reason) VALUES ($1, 'OTHER')`, [other.id]);
    expect(names(await gallery())).toEqual(["Activa"]);

    await getPool().query(`UPDATE "Suspension" SET ended_at = now() WHERE user_id = $1`, [other.id]);
    expect(names(await gallery())).toEqual(["Activa", "Suspendida"]);
  });

  it("CU-09: hides the pets of a deleted shelter account", async () => {
    const other = await createShelter();
    await createPet({ shelterId: other.id, name: "Eliminada" });
    await getPool().query(`UPDATE "App_user" SET deleted_at = now() WHERE id = $1`, [other.id]);
    expect(await gallery()).toEqual([]);
  });

  it("RN-77, CU-09: an adopter does not see the pets of a shelter that has blocked them", async () => {
    const adopter = await createAdopter();
    const other = await createAdopter();
    const blocking = await createShelter();
    await createPet({ shelterId: blocking.id, name: "Bloqueada" });
    await createPet({ shelterId: shelter.id, name: "Visible" });
    await getPool().query(`INSERT INTO "Block" (shelter_id, adopter_id, reason) VALUES ($1, $2, 'OTHER')`, [blocking.id, adopter.id]);

    expect(names(await gallery("", await sessionCookie(adopter.id)))).toEqual(["Visible"]);
    expect(names(await gallery("", await sessionCookie(other.id)))).toEqual(["Bloqueada", "Visible"]);
    expect(names(await gallery())).toEqual(["Bloqueada", "Visible"]);
  });

  it("RN-77: a lifted block no longer hides the pets", async () => {
    const adopter = await createAdopter();
    await createPet({ shelterId: shelter.id, name: "Visible" });
    await getPool().query(
      `INSERT INTO "Block" (shelter_id, adopter_id, reason, lifted_at, lifted_by) VALUES ($1, $2, 'OTHER', now(), 'SHELTER')`,
      [shelter.id, adopter.id],
    );
    expect(names(await gallery("", await sessionCookie(adopter.id)))).toEqual(["Visible"]);
  });

  it("CU-09: no pets match the filters: an empty list", async () => {
    await createPet({ shelterId: shelter.id, size: "SMALL" });
    expect(await gallery("?size=LARGE")).toEqual([]);
  });
});

describe("T-14 RN-189 gallery filters", () => {
  it("RN-189: filters by species", async () => {
    await createPet({ shelterId: shelter.id, name: "Perro", breedId: await anyBreedOf("Perro") });
    await createPet({ shelterId: shelter.id, name: "Gato", breedId: await anyBreedOf("Gato") });
    expect(names(await gallery(`?speciesId=${String(await speciesId("Gato"))}`))).toEqual(["Gato"]);
  });

  it("RN-189: filters by breed", async () => {
    const beagle = await breedId("Perro", "Beagle");
    await createPet({ shelterId: shelter.id, name: "Beagle", breedId: beagle });
    await createPet({ shelterId: shelter.id, name: "Otro", breedId: await anyBreedOf("Gato") });
    expect(names(await gallery(`?breedId=${String(beagle)}`))).toEqual(["Beagle"]);
  });

  it("RN-189: filters by size and by sex", async () => {
    await createPet({ shelterId: shelter.id, name: "A", size: "SMALL", sex: "MALE" });
    await createPet({ shelterId: shelter.id, name: "B", size: "SMALL", sex: "FEMALE" });
    await createPet({ shelterId: shelter.id, name: "C", size: "LARGE", sex: "MALE" });
    expect(names(await gallery("?size=SMALL"))).toEqual(["A", "B"]);
    expect(names(await gallery("?sex=MALE"))).toEqual(["A", "C"]);
    expect(names(await gallery("?size=SMALL&sex=MALE"))).toEqual(["A"]);
  });

  it("RN-189: filters by the shelter's province", async () => {
    const gipuzkoa = await createShelter({ provinceId: 20 });
    await createPet({ shelterId: gipuzkoa.id, name: "Donostia" });
    await createPet({ shelterId: shelter.id, name: "Valencia" });
    expect(names(await gallery("?provinceId=20"))).toEqual(["Donostia"]);
  });

  it("RN-205: filters by a minimum age in months, inclusive", async () => {
    await createPet({ shelterId: shelter.id, name: "Seis", birthDate: monthsAgo(6) });
    await createPet({ shelterId: shelter.id, name: "Cinco", birthDate: monthsAgo(5, 1) });
    expect(names(await gallery("?minAgeMonths=6"))).toEqual(["Seis"]);
  });

  it("RN-205: filters by a maximum age in months, inclusive of the whole last month", async () => {
    await createPet({ shelterId: shelter.id, name: "DosAños", birthDate: monthsAgo(24, 10) });
    await createPet({ shelterId: shelter.id, name: "TresAños", birthDate: monthsAgo(36) });
    expect(names(await gallery("?maxAgeMonths=24"))).toEqual(["DosAños"]);
  });

  it("RN-205: without minimum or maximum age, any age", async () => {
    await createPet({ shelterId: shelter.id, name: "Cachorro", birthDate: monthsAgo(2) });
    await createPet({ shelterId: shelter.id, name: "Mayor", birthDate: monthsAgo(150) });
    expect(names(await gallery())).toEqual(["Cachorro", "Mayor"]);
  });

  it("RN-189: the gallery ignores the adopter's preferences", async () => {
    const adopter = await createAdopter();
    await getPool().query(`INSERT INTO "Adopter_preferences" (adopter_id, sizes) VALUES ($1, ARRAY['SMALL'])`, [adopter.id]);
    await createPet({ shelterId: shelter.id, name: "Grande", size: "LARGE" });
    expect(names(await gallery("", await sessionCookie(adopter.id)))).toEqual(["Grande"]);
  });

  it("CU-09: rejects malformed filters with 400", async () => {
    for (const query of ["?size=HUGE", "?sex=X", "?speciesId=abc", "?minAgeMonths=-1", "?provinceId=99999", "?minAgeMonths=12&maxAgeMonths=6"]) {
      const res = await request(createApp()).get(`/api/pets${query}`);
      expect(res.status, query).toBe(400);
      expect(typeof res.body.error).toBe("string");
    }
  });
});
