import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getConfig } from "../../src/server/config.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, type CreatedUser } from "../helpers/factories.js";

let adopter: CreatedUser;
let shelter: CreatedUser;
let cookie: string;

const app = () => createApp();
const addFavorite = (petId: number, as = cookie) => request(app()).put(`/api/adopter/favorites/${String(petId)}`).set("Cookie", as);
const removeFavorite = (petId: number) => request(app()).delete(`/api/adopter/favorites/${String(petId)}`).set("Cookie", cookie);
const recover = (petId: number) => request(app()).delete(`/api/adopter/discards/${String(petId)}`).set("Cookie", cookie);

async function favorites(): Promise<{ id: number; name: string; status: string }[]> {
  const res = await request(app()).get("/api/adopter/favorites").set("Cookie", cookie);
  expect(res.status).toBe(200);
  return res.body.favorites as { id: number; name: string; status: string }[];
}

async function discards(): Promise<{ id: number; name: string }[]> {
  const res = await request(app()).get("/api/adopter/discards").set("Cookie", cookie);
  expect(res.status).toBe(200);
  return res.body.discards as { id: number; name: string }[];
}

async function rate(petId: number, type: "FAVORITE" | "DISCARDED", daysAgo = 0): Promise<void> {
  await getPool().query(
    `INSERT INTO adopter_pet_rel (adopter_id, pet_id, type, created_at) VALUES ($1, $2, $3, now() - make_interval(days => $4))`,
    [adopter.id, petId, type, daysAgo],
  );
}

async function ratings(): Promise<{ pet_id: number; type: string }[]> {
  const { rows } = await getPool().query<{ pet_id: number; type: string }>(
    `SELECT pet_id, type FROM adopter_pet_rel WHERE adopter_id = $1 ORDER BY pet_id`,
    [adopter.id],
  );
  return rows;
}

const newPet = async (name: string) => (await createPet({ shelterId: shelter.id, name })).id;

beforeEach(async () => {
  await truncateAll();
  adopter = await createAdopter();
  shelter = await createShelter();
  cookie = await sessionCookie(adopter.id);
});

describe("T-19 CU-12 PUT /api/adopter/favorites/:petId", () => {
  it("RN-73: adds a pet to favourites from the gallery or the profile", async () => {
    const pet = await newPet("Luna");
    const res = await addFavorite(pet);
    expect(res.status).toBe(200);
    expect(await ratings()).toEqual([{ pet_id: pet, type: "FAVORITE" }]);
    expect((await addFavorite(pet)).status).toBe(200);
    expect(await ratings()).toHaveLength(1);
  });

  it("RN-74: a discarded pet added to favourites stops being discarded", async () => {
    const pet = await newPet("Luna");
    await rate(pet, "DISCARDED");
    expect((await addFavorite(pet)).status).toBe(200);
    expect(await ratings()).toEqual([{ pet_id: pet, type: "FAVORITE" }]);
  });

  it("CU-12: the pet is no longer visible to the adopter", async () => {
    const reserved = await newPet("Reservada");
    await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [reserved]);
    const blocking = await createShelter();
    const blocked = (await createPet({ shelterId: blocking.id })).id;
    await getPool().query(`INSERT INTO "Block" (shelter_id, adopter_id, reason) VALUES ($1, $2, 'OTHER')`, [blocking.id, adopter.id]);

    for (const pet of [reserved, blocked, blocked + 1000]) {
      const res = await addFavorite(pet);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Esta mascota no está disponible.");
    }
    expect(await ratings()).toEqual([]);
  });

  it("RN-187: only adopters keep favourites", async () => {
    const pet = await newPet("Luna");
    expect((await addFavorite(pet, await sessionCookie(shelter.id))).status).toBe(403);
    expect((await request(app()).put(`/api/adopter/favorites/${String(pet)}`)).status).toBe(401);
  });
});

describe("T-19 CU-12 GET /api/adopter/favorites", () => {
  it("CU-12: lists the favourites, most recent first, with their status; discards are not included", async () => {
    const old = await newPet("Antigua");
    const recent = await newPet("Reciente");
    const discarded = await newPet("Descartada");
    await rate(old, "FAVORITE", 2);
    await rate(recent, "FAVORITE", 0);
    await rate(discarded, "DISCARDED");
    await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [old]);

    expect(await favorites()).toEqual([
      expect.objectContaining({ id: recent, name: "Reciente", status: "AVAILABLE", shelterName: expect.any(String) }),
      expect.objectContaining({ id: old, name: "Antigua", status: "RESERVED" }),
    ]);
  });

  it("RN-23, RN-77: hides the favourites of shelters that blocked the adopter or are no longer validated", async () => {
    const visible = await newPet("Visible");
    await rate(visible, "FAVORITE");
    const blocking = await createShelter();
    const blocked = (await createPet({ shelterId: blocking.id })).id;
    await rate(blocked, "FAVORITE");
    await getPool().query(`INSERT INTO "Block" (shelter_id, adopter_id, reason) VALUES ($1, $2, 'OTHER')`, [blocking.id, adopter.id]);
    const revoked = await createShelter();
    const ofRevoked = (await createPet({ shelterId: revoked.id })).id;
    await rate(ofRevoked, "FAVORITE");
    await getPool().query(`UPDATE "Shelter" SET validation_status = 'REJECTED', validation_reason = 'x' WHERE user_id = $1`, [revoked.id]);
    const suspended = await createShelter();
    const ofSuspended = (await createPet({ shelterId: suspended.id })).id;
    await rate(ofSuspended, "FAVORITE");
    await getPool().query(`INSERT INTO "Suspension" (user_id, reason) VALUES ($1, 'OTHER')`, [suspended.id]);

    expect((await favorites()).map((f) => f.id)).toEqual([visible]);
  });

  it("CU-12: no favourites: an empty list", async () => {
    expect(await favorites()).toEqual([]);
  });
});

describe("T-19 CU-12 DELETE /api/adopter/favorites/:petId", () => {
  it("RN-76: removes a favourite without keeping history", async () => {
    const pet = await newPet("Luna");
    await rate(pet, "FAVORITE");
    const res = await removeFavorite(pet);
    expect(res.status).toBe(204);
    expect(await ratings()).toEqual([]);
  });

  it("RN-76: a removed favourite can be removed even if the pet is no longer available", async () => {
    const pet = await newPet("Luna");
    await rate(pet, "FAVORITE");
    await getPool().query(`UPDATE "Pet" SET status = 'ADOPTED' WHERE id = $1`, [pet]);
    expect((await removeFavorite(pet)).status).toBe(204);
  });

  it("CU-12: answers 404 when the pet is not a favourite (a discard is not removed)", async () => {
    const pet = await newPet("Luna");
    await rate(pet, "DISCARDED");
    expect((await removeFavorite(pet)).status).toBe(404);
    expect(await ratings()).toEqual([{ pet_id: pet, type: "DISCARDED" }]);
  });
});

describe("T-19 CU-12 discarded pets", () => {
  it("CU-12, RN-75: lists the discards still in force, most recent first", async () => {
    const days = getConfig().rules.discardDurationDays;
    const recent = await newPet("Reciente");
    const older = await newPet("Anterior");
    const expired = await newPet("Caducada");
    await rate(recent, "DISCARDED", 0);
    await rate(older, "DISCARDED", 1);
    await rate(expired, "DISCARDED", days + 1);
    expect((await discards()).map((d) => d.name)).toEqual(["Reciente", "Anterior"]);
  });

  it("RN-77: hides the discards of shelters that blocked the adopter", async () => {
    const blocking = await createShelter();
    const pet = (await createPet({ shelterId: blocking.id })).id;
    await rate(pet, "DISCARDED");
    await getPool().query(`INSERT INTO "Block" (shelter_id, adopter_id, reason) VALUES ($1, $2, 'OTHER')`, [blocking.id, adopter.id]);
    expect(await discards()).toEqual([]);
  });

  it("RN-76, CU-12: recovering a discarded pet deletes the discard", async () => {
    const pet = await newPet("Luna");
    await rate(pet, "DISCARDED");
    expect((await recover(pet)).status).toBe(204);
    expect(await ratings()).toEqual([]);
  });

  it("CU-12: answers 404 when the pet is not discarded (a favourite is not removed)", async () => {
    const pet = await newPet("Luna");
    await rate(pet, "FAVORITE");
    expect((await recover(pet)).status).toBe(404);
    expect(await ratings()).toEqual([{ pet_id: pet, type: "FAVORITE" }]);
  });
});
