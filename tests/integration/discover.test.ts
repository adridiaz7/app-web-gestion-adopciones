import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getConfig } from "../../src/server/config.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, type CreatedUser } from "../helpers/factories.js";

const URL = "/api/adopter/discover";

interface StateBody {
  pet: { id: number; name: string } | null;
  remaining: number;
  hasPreferences: boolean;
}

let adopter: CreatedUser;
let shelter: CreatedUser;
let cookie: string;

async function state(as = cookie): Promise<StateBody> {
  const res = await request(createApp()).get(URL).set("Cookie", as);
  expect(res.status).toBe(200);
  return res.body as StateBody;
}

const act = (petId: number, action: "favorite" | "discard") =>
  request(createApp()).post(`${URL}/pets/${String(petId)}/${action}`).set("Cookie", cookie);

const undo = (petId: number) => request(createApp()).post(`${URL}/undo`).set("Cookie", cookie).send({ petId });

async function ratings(): Promise<{ pet_id: number; type: string }[]> {
  const { rows } = await getPool().query<{ pet_id: number; type: string }>(
    `SELECT pet_id, type FROM adopter_pet_rel WHERE adopter_id = $1 ORDER BY pet_id`,
    [adopter.id],
  );
  return rows;
}

async function pet(name: string, extra: Partial<Parameters<typeof createPet>[0]> = {}): Promise<number> {
  return (await createPet({ shelterId: shelter.id, name, ...extra })).id;
}

/** Makes the pet older in the list, so the order is predictable (newest first). */
async function ageRow(petId: number, days: number): Promise<void> {
  await getPool().query(`UPDATE "Pet" SET created_at = now() - make_interval(days => $2) WHERE id = $1`, [petId, days]);
}

async function setPreferences(sql: string, params: unknown[] = []): Promise<void> {
  await getPool().query(`INSERT INTO "Adopter_preferences" (adopter_id) VALUES ($1)`, [adopter.id]);
  if (sql) await getPool().query(sql, [adopter.id, ...params]);
}

beforeEach(async () => {
  await truncateAll();
  adopter = await createAdopter();
  shelter = await createShelter();
  cookie = await sessionCookie(adopter.id);
});

describe("T-18 CU-10 GET /api/adopter/discover", () => {
  it("RN-190: without a questionnaire, shows every available pet and says there are no preferences", async () => {
    const older = await pet("Antigua");
    await ageRow(older, 1);
    await pet("Nueva", { size: "LARGE" });
    expect(await state()).toEqual({
      pet: expect.objectContaining({ name: "Nueva", shelterName: expect.any(String) }),
      remaining: 2,
      hasPreferences: false,
    });
  });

  it("CU-10: no compatible pets left: no pet", async () => {
    expect(await state()).toEqual({ pet: null, remaining: 0, hasPreferences: false });
  });

  it("RN-70: only visible pets (available, validated shelter, no block)", async () => {
    const reserved = await pet("Reservada");
    await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [reserved]);
    const blocking = await createShelter();
    await createPet({ shelterId: blocking.id, name: "Bloqueada" });
    await getPool().query(`INSERT INTO "Block" (shelter_id, adopter_id, reason) VALUES ($1, $2, 'OTHER')`, [blocking.id, adopter.id]);
    const pending = await createShelter({ validationStatus: "PENDING" });
    await createPet({ shelterId: pending.id });
    await pet("Visible");
    expect(await state()).toEqual(expect.objectContaining({ pet: expect.objectContaining({ name: "Visible" }), remaining: 1 }));
  });

  it("RN-71: filters by size, sex and activity level from the questionnaire", async () => {
    await setPreferences(`UPDATE "Adopter_preferences" SET sizes = '{SMALL}', sexes = '{MALE}', activity_levels = '{LOW,HIGH}' WHERE adopter_id = $1`);
    await pet("Encaja", { size: "SMALL", sex: "MALE", activityLevel: "HIGH" });
    await pet("Grande", { size: "LARGE", sex: "MALE", activityLevel: "HIGH" });
    await pet("Hembra", { size: "SMALL", sex: "FEMALE", activityLevel: "HIGH" });
    await pet("Media", { size: "SMALL", sex: "MALE", activityLevel: "MEDIUM" });
    expect(await state()).toEqual({ pet: expect.objectContaining({ name: "Encaja" }), remaining: 1, hasPreferences: true });
  });

  it("RN-71, RN-205: the pet's age must be within the range", async () => {
    await setPreferences(`UPDATE "Adopter_preferences" SET min_age_months = 12, max_age_months = 36 WHERE adopter_id = $1`);
    const today = new Date();
    const yearsAgo = (n: number) => `${String(today.getFullYear() - n)}-01-01`;
    await pet("Cachorro", { birthDate: `${String(today.getFullYear())}-01-01` });
    await pet("Dos", { birthDate: yearsAgo(2) });
    await pet("Diez", { birthDate: yearsAgo(10) });
    expect((await state()).pet?.name).toBe("Dos");
  });

  it("RN-71: filters by wanted species and breeds", async () => {
    const { rows } = await getPool().query<{ dog: number; beagle: number; cat: number; catBreed: number }>(
      `SELECT (SELECT id FROM "Species" WHERE name = 'Perro') AS dog, (SELECT id FROM "Breed" WHERE name = 'Beagle') AS beagle,
              (SELECT id FROM "Species" WHERE name = 'Gato') AS cat,
              (SELECT min(b.id) FROM "Breed" b JOIN "Species" s ON s.id = b.species_id WHERE s.name = 'Gato') AS "catBreed"`,
    );
    const ids = rows[0];
    if (!ids) throw new Error("catalogue");
    await setPreferences(
      `INSERT INTO adopter_preferences_species_rel (adopter_id, species_id, is_wanted, must_get_along) VALUES ($1, $2, true, false)`,
      [ids.dog],
    );
    await pet("Gato", { breedId: ids.catBreed });
    await pet("Beagle", { breedId: ids.beagle });
    expect(await state()).toEqual(expect.objectContaining({ pet: expect.objectContaining({ name: "Beagle" }), remaining: 1 }));

    await getPool().query(`INSERT INTO adopter_preferences_breed_rel (adopter_id, breed_id) SELECT $1, min(id) FROM "Breed" WHERE id <> $2 AND species_id = $3`, [
      adopter.id,
      ids.beagle,
      ids.dog,
    ]);
    expect((await state()).pet).toBeNull();
  });

  it("RN-36: needing a pet good with children excludes NO and UNKNOWN", async () => {
    await setPreferences(`UPDATE "Adopter_preferences" SET needs_good_with_children = true WHERE adopter_id = $1`);
    for (const [name, value] of [["Si", "YES"], ["No", "NO"], ["NoSe", "UNKNOWN"]] as const) {
      const id = await pet(name);
      await getPool().query(`UPDATE "Pet" SET good_with_children = $2 WHERE id = $1`, [id, value]);
    }
    expect(await state()).toEqual(expect.objectContaining({ pet: expect.objectContaining({ name: "Si" }), remaining: 1 }));
  });

  it("RN-37: must get along with every marked species", async () => {
    await setPreferences(
      `INSERT INTO adopter_preferences_species_rel (adopter_id, species_id, is_wanted, must_get_along)
       SELECT $1, id, false, true FROM "Species"`,
    );
    const both = await pet("Ambas");
    const onlyOne = await pet("Una");
    await pet("NoSe");
    await getPool().query(
      `INSERT INTO pet_species_rel (pet_id, species_id, gets_along)
       SELECT $1::bigint, id, true FROM "Species"
       UNION ALL SELECT $2::bigint, id, name = 'Perro' FROM "Species"`,
      [both, onlyOne],
    );
    expect(await state()).toEqual(expect.objectContaining({ pet: expect.objectContaining({ name: "Ambas" }), remaining: 1 }));
  });

  it("RN-189: the gallery is not affected by the questionnaire, but discover is", async () => {
    await setPreferences(`UPDATE "Adopter_preferences" SET sizes = '{SMALL}' WHERE adopter_id = $1`);
    await pet("Grande", { size: "LARGE" });
    expect((await state()).pet).toBeNull();
  });

  it("CU-10: only adopters", async () => {
    const res = await request(createApp()).get(URL).set("Cookie", await sessionCookie(shelter.id));
    expect(res.status).toBe(403);
    expect((await request(createApp()).get(URL)).status).toBe(401);
  });
});

describe("T-18 CU-10 favourite and discard", () => {
  it("RN-72: a favourite is saved and the next pet is shown", async () => {
    const first = await pet("Primera");
    const second = await pet("Segunda");
    await ageRow(second, 1);

    const res = await act(first, "favorite");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ pet: expect.objectContaining({ id: second }), remaining: 1 }));
    expect(await ratings()).toEqual([{ pet_id: first, type: "FAVORITE" }]);
  });

  it("RN-72, RN-70: a discarded pet does not show up again while the discard lasts", async () => {
    const first = await pet("Primera");
    const res = await act(first, "discard");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ pet: null, remaining: 0 }));
    expect(await ratings()).toEqual([{ pet_id: first, type: "DISCARDED" }]);
  });

  it("RN-75: after the configured days the discard expires and the pet shows up again", async () => {
    const days = getConfig().rules.discardDurationDays;
    const first = await pet("Primera");
    await act(first, "discard");
    await getPool().query(`UPDATE adopter_pet_rel SET created_at = now() - make_interval(days => $2, mins => 1) WHERE adopter_id = $1`, [adopter.id, days]);
    expect((await state()).pet?.id).toBe(first);

    // Discarding it again renews the discard (RN-74: still one rating).
    await act(first, "discard");
    expect((await state()).pet).toBeNull();
    expect(await ratings()).toEqual([{ pet_id: first, type: "DISCARDED" }]);
  });

  it("RN-74: favouriting a pet whose discard expired replaces the rating", async () => {
    const first = await pet("Primera");
    await act(first, "discard");
    await getPool().query(`UPDATE adopter_pet_rel SET created_at = now() - interval '400 days' WHERE adopter_id = $1`, [adopter.id]);
    expect((await act(first, "favorite")).status).toBe(200);
    expect(await ratings()).toEqual([{ pet_id: first, type: "FAVORITE" }]);
  });

  it("RN-74: a favourite cannot be discarded from discover", async () => {
    const first = await pet("Primera");
    await act(first, "favorite");
    const res = await act(first, "discard");
    expect(res.status).toBe(409);
    expect(await ratings()).toEqual([{ pet_id: first, type: "FAVORITE" }]);
  });

  it("RN-70: cannot rate a pet that is not visible to the adopter", async () => {
    const blocking = await createShelter();
    const hidden = (await createPet({ shelterId: blocking.id })).id;
    await getPool().query(`INSERT INTO "Block" (shelter_id, adopter_id, reason) VALUES ($1, $2, 'OTHER')`, [blocking.id, adopter.id]);
    for (const action of ["favorite", "discard"] as const) {
      expect((await act(hidden, action)).status).toBe(404);
    }
    expect((await act(hidden + 1000, "favorite")).status).toBe(404);
    expect(await ratings()).toEqual([]);
  });
});

describe("T-18 CU-10 POST /api/adopter/discover/undo", () => {
  it("RN-191: undoing the last discard deletes it and shows that pet again first", async () => {
    const first = await pet("Primera");
    const second = await pet("Segunda");
    await ageRow(first, 1);
    await act(second, "discard");

    const res = await undo(second);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ pet: expect.objectContaining({ id: second }), remaining: 2 }));
    expect(await ratings()).toEqual([]);
  });

  it("RN-191: only the most recent discard can be undone", async () => {
    const first = await pet("Primera");
    const second = await pet("Segunda");
    await act(first, "discard");
    await act(second, "discard");
    await getPool().query(`UPDATE adopter_pet_rel SET created_at = created_at - interval '1 minute' WHERE pet_id = $1`, [first]);

    const res = await undo(first);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("No hay un descarte inmediatamente anterior que deshacer.");
    expect(await ratings()).toHaveLength(2);
  });

  it("CU-10: there is no discard to undo", async () => {
    const first = await pet("Primera");
    await act(first, "favorite");
    const res = await undo(first);
    expect(res.status).toBe(409);
    expect(await ratings()).toEqual([{ pet_id: first, type: "FAVORITE" }]);
  });

  it("CU-10: rejects a malformed undo request", async () => {
    const res = await request(createApp()).post(`${URL}/undo`).set("Cookie", cookie).send({ petId: "x" });
    expect(res.status).toBe(400);
  });
});
