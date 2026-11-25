import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, type CreatedUser } from "../helpers/factories.js";

const URL = "/api/adopter/preferences";

let adopter: CreatedUser;
let cookie: string;
let dog: number;
let cat: number;
let beagle: number;

const EMPTY = {
  speciesIds: [],
  breedIds: [],
  sizes: [],
  sexes: [],
  activityLevels: [],
  minAgeMonths: null,
  maxAgeMonths: null,
  needsGoodWithChildren: false,
  mustGetAlongWithSpeciesIds: [],
};

const put = (body: unknown, as = cookie) => request(createApp()).put(URL).set("Cookie", as).send(body as object);
const get = (as = cookie) => request(createApp()).get(URL).set("Cookie", as);

async function idOf(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await getPool().query<{ id: number }>(sql, params);
  const row = rows[0];
  if (!row) throw new Error(`Not found: ${String(params[0])}`);
  return row.id;
}

beforeEach(async () => {
  await truncateAll();
  adopter = await createAdopter();
  cookie = await sessionCookie(adopter.id);
  dog = await idOf(`SELECT id FROM "Species" WHERE name = $1`, ["Perro"]);
  cat = await idOf(`SELECT id FROM "Species" WHERE name = $1`, ["Gato"]);
  beagle = await idOf(`SELECT id FROM "Breed" WHERE name = $1`, ["Beagle"]);
});

describe("T-17 CU-08 GET /api/adopter/preferences", () => {
  it("RN-30, RN-190: an adopter who never filled in the questionnaire has no preferences", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferences: null });
  });

  it("CU-08: only adopters have preferences", async () => {
    const shelter = await createShelter();
    expect((await get(await sessionCookie(shelter.id))).status).toBe(403);
    expect((await request(createApp()).get(URL)).status).toBe(401);
  });
});

describe("T-17 CU-08 PUT /api/adopter/preferences", () => {
  it("RN-32, RN-33: saves every question, with several answers each, and returns them", async () => {
    const body = {
      speciesIds: [dog],
      breedIds: [beagle],
      sizes: ["MEDIUM", "LARGE"],
      sexes: ["FEMALE"],
      activityLevels: ["LOW", "MEDIUM"],
      minAgeMonths: 12,
      maxAgeMonths: 60,
      needsGoodWithChildren: true,
      mustGetAlongWithSpeciesIds: [dog, cat],
    };
    const res = await put(body);
    expect(res.status).toBe(200);
    expect(res.body.preferences).toEqual({ ...body, mustGetAlongWithSpeciesIds: [cat, dog].sort((a, b) => a - b) });
    expect((await get()).body.preferences).toEqual(res.body.preferences);
  });

  it("RN-34, RN-35: an empty questionnaire is saved: everything is \"me da igual\"", async () => {
    const res = await put(EMPTY);
    expect(res.status).toBe(200);
    expect(res.body.preferences).toEqual(EMPTY);
    const { rowCount } = await getPool().query(`SELECT 1 FROM "Adopter_preferences" WHERE adopter_id = $1`, [adopter.id]);
    expect(rowCount).toBe(1);
  });

  it("RN-34: unanswered questions can be left out of the body", async () => {
    const res = await put({ sizes: ["SMALL"] });
    expect(res.status).toBe(200);
    expect(res.body.preferences).toEqual({ ...EMPTY, sizes: ["SMALL"] });
  });

  it("RN-31: editing replaces the previous answers", async () => {
    await put({ ...EMPTY, speciesIds: [dog], breedIds: [beagle], mustGetAlongWithSpeciesIds: [cat], sizes: ["SMALL"] });
    const res = await put({ ...EMPTY, speciesIds: [cat] });
    expect(res.body.preferences).toEqual({ ...EMPTY, speciesIds: [cat] });
  });

  it("RN-37: a species can be both wanted and required to get along with, in one row", async () => {
    await put({ ...EMPTY, speciesIds: [dog], mustGetAlongWithSpeciesIds: [dog] });
    const { rows } = await getPool().query(
      `SELECT species_id, is_wanted, must_get_along FROM adopter_preferences_species_rel WHERE adopter_id = $1`,
      [adopter.id],
    );
    expect(rows).toEqual([{ species_id: dog, is_wanted: true, must_get_along: true }]);
  });

  it("RN-38: editing deletes the adopter's discards and keeps the favourites", async () => {
    const shelter = await createShelter();
    const discarded = await createPet({ shelterId: shelter.id });
    const favourite = await createPet({ shelterId: shelter.id });
    const other = await createAdopter();
    await getPool().query(
      `INSERT INTO adopter_pet_rel (adopter_id, pet_id, type) VALUES ($1, $2, 'DISCARDED'), ($1, $3, 'FAVORITE'), ($4, $2, 'DISCARDED')`,
      [adopter.id, discarded.id, favourite.id, other.id],
    );

    expect((await put(EMPTY)).status).toBe(200);
    const { rows } = await getPool().query<{ adopter_id: number; type: string }>(
      `SELECT adopter_id, type FROM adopter_pet_rel ORDER BY adopter_id, type`,
    );
    expect(rows).toEqual([
      { adopter_id: adopter.id, type: "FAVORITE" },
      { adopter_id: other.id, type: "DISCARDED" },
    ]);
  });

  it("RN-205: rejects a minimum age greater than the maximum", async () => {
    const res = await put({ ...EMPTY, minAgeMonths: 24, maxAgeMonths: 12 });
    expect(res.status).toBe(400);
  });

  it("CU-08: rejects unknown species or breeds with 400", async () => {
    expect((await put({ ...EMPTY, speciesIds: [9999] })).status).toBe(400);
    expect((await put({ ...EMPTY, mustGetAlongWithSpeciesIds: [9999] })).status).toBe(400);
    expect((await put({ ...EMPTY, breedIds: [999999] })).status).toBe(400);
    const { rowCount } = await getPool().query(`SELECT 1 FROM "Adopter_preferences"`);
    expect(rowCount).toBe(0);
  });

  it("CU-08: rejects malformed answers with 400", async () => {
    for (const body of [
      { sizes: ["HUGE"] },
      { sexes: "MALE" },
      { activityLevels: ["LOW", "LOW"] },
      { minAgeMonths: -1 },
      { maxAgeMonths: 1.5 },
      { needsGoodWithChildren: "yes" },
      { speciesIds: [0] },
    ]) {
      const res = await put({ ...EMPTY, ...body });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("RN-208: records the change of preferences in the audit log", async () => {
    await put({ ...EMPTY, sizes: ["SMALL"] });
    await put({ ...EMPTY, sizes: ["LARGE"] });
    const { rows } = await getPool().query<{ actor_user_id: number; details: { before: { sizes: string[] } | null; after: { sizes: string[] } } }>(
      `SELECT actor_user_id, details FROM "Audit_log" WHERE action = 'PREFERENCES_UPDATED' ORDER BY id`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.details.before).toBeNull();
    expect(rows[1]?.actor_user_id).toBe(adopter.id);
    expect(rows[1]?.details.before?.sizes).toEqual(["SMALL"]);
    expect(rows[1]?.details.after.sizes).toEqual(["LARGE"]);
  });

  it("CU-08: only adopters can save preferences", async () => {
    const shelter = await createShelter();
    expect((await put(EMPTY, await sessionCookie(shelter.id))).status).toBe(403);
  });
});
