import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createShelter } from "../helpers/factories.js";

let adminId: number;
let cookie: string;

const post = (url: string, body: object, as = cookie) => request(createApp()).post(`/api/admin${url}`).set("Cookie", as).send(body);
const put = (url: string, body: object, as = cookie) => request(createApp()).put(`/api/admin${url}`).set("Cookie", as).send(body);
const speciesNamed = async (name: string) => (await getPool().query<{ id: number }>(`SELECT id FROM "Species" WHERE name = $1`, [name])).rows[0]?.id ?? 0;
const audits = async (action: string) =>
  (await getPool().query(`SELECT actor_user_id, details FROM "Audit_log" WHERE action = $1 ORDER BY id`, [action])).rows;

/** The catalogues survive truncateAll (they come with the schema), so remove what these tests add. */
async function removeTestCatalogue(): Promise<void> {
  await getPool().query(`DELETE FROM "Breed" WHERE name ILIKE 'pach%' OR name = 'X'`);
  await getPool().query(`DELETE FROM "Species" WHERE name ILIKE 'hur%'`);
}

afterEach(removeTestCatalogue);

beforeEach(async () => {
  await removeTestCatalogue();
  await truncateAll();
  const admin = await createAdmin();
  adminId = admin.id;
  cookie = await sessionCookie(admin.id);
});

describe("T-40 CU-42 species", () => {
  it("RN-159, RN-208: the administrator adds a species, audited, and it appears in the catalogue", async () => {
    const res = await post("/species", { name: "  Hurón " });

    expect(res.status).toBe(201);
    expect(res.body.species).toEqual({ id: expect.any(Number), name: "Hurón" });
    expect(await audits("SPECIES_CREATED")).toEqual([{ actor_user_id: adminId, details: { after: { name: "Hurón" } } }]);
    const breeds = await request(createApp()).get("/api/breeds");
    expect(breeds.body.species.map((s: { name: string }) => s.name)).toContain("Hurón");
  });

  it("RN-159, RN-208: the administrator renames a species, audited with the old and new name", async () => {
    const id = (await post("/species", { name: "Huron" })).body.species.id as number;

    const res = await put(`/species/${String(id)}`, { name: "Hurón" });

    expect(res.status).toBe(200);
    expect(res.body.species).toEqual({ id, name: "Hurón" });
    expect(await audits("SPECIES_UPDATED")).toEqual([{ actor_user_id: adminId, details: { before: { name: "Huron" }, after: { name: "Hurón" } } }]);
  });

  it("CU-42: rejects a species with a name that already exists, ignoring upper and lower case", async () => {
    const res = await post("/species", { name: "PERRO" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Ya existe una especie con ese nombre." });
    const id = (await post("/species", { name: "Hurón" })).body.species.id as number;
    expect((await put(`/species/${String(id)}`, { name: "gato" })).status).toBe(409);
    // Keeping its own name is not a duplicate.
    expect((await put(`/species/${String(id)}`, { name: "Hurón" })).status).toBe(200);
  });

  it("CU-42: the name is required, and an unknown species answers 404", async () => {
    expect((await post("/species", { name: "  " })).status).toBe(400);
    expect((await put("/species/9999", { name: "Hurón" })).status).toBe(404);
  });
});

describe("T-40 CU-42 breeds", () => {
  it("RN-159, RN-208: the administrator adds a breed to a species, audited", async () => {
    const dog = await speciesNamed("Perro");

    const res = await post("/breeds", { speciesId: dog, name: "Pachón navarro" });

    expect(res.status).toBe(201);
    expect(res.body.breed).toEqual({ id: expect.any(Number), speciesId: dog, name: "Pachón navarro" });
    expect(await audits("BREED_CREATED")).toEqual([{ actor_user_id: adminId, details: { after: { speciesId: dog, name: "Pachón navarro" } } }]);
  });

  it("RN-159: the administrator renames a breed", async () => {
    const dog = await speciesNamed("Perro");
    const id = (await post("/breeds", { speciesId: dog, name: "Pachon" })).body.breed.id as number;

    const res = await put(`/breeds/${String(id)}`, { name: "Pachón navarro" });

    expect(res.status).toBe(200);
    expect(res.body.breed).toEqual({ id, speciesId: dog, name: "Pachón navarro" });
    expect(await audits("BREED_UPDATED")).toHaveLength(1);
  });

  it("CU-42: rejects a breed with a name that already exists in that species, but not in another", async () => {
    const dog = await speciesNamed("Perro");
    const cat = await speciesNamed("Gato");
    await post("/breeds", { speciesId: dog, name: "Pachón navarro" });

    const res = await post("/breeds", { speciesId: dog, name: "pachón NAVARRO" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Ya existe una raza con ese nombre en esta especie." });
    expect((await post("/breeds", { speciesId: cat, name: "Pachón navarro" })).status).toBe(201);
  });

  it("CU-42: a breed must belong to an existing species", async () => {
    const missing = await post("/breeds", { name: "Pachón navarro" });
    const unknown = await post("/breeds", { speciesId: 9999, name: "Pachón navarro" });

    expect(missing.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(unknown.body).toEqual({ error: "La especie no existe." });
    expect((await put("/breeds/999999", { name: "X" })).status).toBe(404);
  });

  it("CU-42: only the administrator manages the catalogues, and a session is required", async () => {
    const shelter = await createShelter();
    expect((await request(createApp()).post("/api/admin/species").send({ name: "Hurón" })).status).toBe(401);
    expect((await post("/species", { name: "Hurón" }, await sessionCookie(shelter.id))).status).toBe(403);
    expect((await post("/breeds", { speciesId: await speciesNamed("Perro"), name: "X" }, await sessionCookie(shelter.id))).status).toBe(403);
    expect(await speciesNamed("Hurón")).toBe(0);
  });
});
