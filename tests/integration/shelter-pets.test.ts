import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createShelter, type CreatedUser } from "../helpers/factories.js";

const PETS = "/api/shelter/pets";

let shelter: CreatedUser;
let cookie: string;
let dogMixedBreedId: number;
let catSpeciesId: number;
let dogSpeciesId: number;

async function catalogue(): Promise<void> {
  const { rows } = await getPool().query<{ breed_id: number; dog: number; cat: number }>(
    `SELECT b.id AS breed_id,
            (SELECT id FROM "Species" WHERE name = 'Perro') AS dog,
            (SELECT id FROM "Species" WHERE name = 'Gato') AS cat
       FROM "Breed" b JOIN "Species" s ON s.id = b.species_id
      WHERE s.name = 'Perro' AND b.name = 'Mestizo / Desconocida'`,
  );
  const row = rows[0];
  if (!row) throw new Error("catalogue missing");
  dogMixedBreedId = row.breed_id;
  dogSpeciesId = row.dog;
  catSpeciesId = row.cat;
}

const validPet = () => ({
  name: "Txuri",
  breedId: dogMixedBreedId,
  description: "Perra muy cariñosa.",
  birthDate: "2022-05-01",
  sex: "FEMALE",
  size: "MEDIUM",
  activityLevel: "MEDIUM",
  goodWithChildren: "YES",
  getsAlongWith: [{ speciesId: catSpeciesId, getsAlong: false }],
  vaccinated: true,
  dewormed: true,
  sterilized: false,
  microchipped: true,
  specialNeeds: null,
});

const createPetRequest = (body: object, as = cookie) => request(createApp()).post(PETS).set("Cookie", as).send(body);

beforeEach(async () => {
  await truncateAll();
  await catalogue();
  shelter = await createShelter();
  cookie = await sessionCookie(shelter.id);
});

describe("T-12 CU-15 POST /api/shelter/pets", () => {
  it("CU-15, RN-53, RN-49: creates an available pet with its creation date", async () => {
    const res = await createPetRequest(validPet());

    expect(res.status).toBe(201);
    expect(res.body.pet).toMatchObject({
      name: "Txuri",
      breedId: dogMixedBreedId,
      speciesId: dogSpeciesId,
      status: "AVAILABLE",
      birthDate: "2022-05-01",
      getsAlongWith: [{ speciesId: catSpeciesId, getsAlong: false }],
    });
    const { rows } = await getPool().query(`SELECT shelter_id, status, created_at IS NOT NULL AS dated FROM "Pet"`);
    expect(rows).toEqual([{ shelter_id: shelter.id, status: "AVAILABLE", dated: true }]);
  });

  it("RN-46: stores getting along with other animals per species; no row means unknown", async () => {
    await createPetRequest({ ...validPet(), getsAlongWith: [] });

    const { rows } = await getPool().query(`SELECT * FROM pet_species_rel`);
    expect(rows).toEqual([]);
  });

  it("RN-22, CU-15: a shelter pending validation can create pets", async () => {
    const pending = await createShelter({ validationStatus: "PENDING" });

    const res = await createPetRequest(validPet(), await sessionCookie(pending.id));

    expect(res.status).toBe(201);
  });

  it("CU-15: rejects missing mandatory data, field by field", async () => {
    const res = await createPetRequest({});

    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fields)).toEqual(
      expect.arrayContaining(["name", "breedId", "description", "birthDate", "sex", "size", "activityLevel", "vaccinated"]),
    );
    expect((await getPool().query(`SELECT 1 FROM "Pet"`)).rowCount).toBe(0);
  });

  it("RN-44, RN-45: rejects values outside the allowed lists", async () => {
    const res = await createPetRequest({ ...validPet(), size: "HUGE", sex: "OTHER", goodWithChildren: "MAYBE" });

    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fields)).toEqual(expect.arrayContaining(["size", "sex", "goodWithChildren"]));
  });

  it("RN-43: rejects a birth date in the future", async () => {
    const res = await createPetRequest({ ...validPet(), birthDate: "2999-01-01" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "La fecha de nacimiento no puede ser futura." });
  });

  it("RN-40: rejects a breed that does not exist", async () => {
    const res = await createPetRequest({ ...validPet(), breedId: 999999 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "La raza no existe." });
  });

  it("RN-46: rejects a species that does not exist or is repeated", async () => {
    const unknown = await createPetRequest({ ...validPet(), getsAlongWith: [{ speciesId: 999, getsAlong: true }] });
    const repeated = await createPetRequest({
      ...validPet(),
      getsAlongWith: [
        { speciesId: catSpeciesId, getsAlong: true },
        { speciesId: catSpeciesId, getsAlong: false },
      ],
    });

    expect(unknown.status).toBe(400);
    expect(unknown.body).toEqual({ error: "La especie no existe." });
    expect(repeated.status).toBe(400);
  });

  it("CU-15: only shelters can create pets", async () => {
    const adopter = await createAdopter();

    expect((await request(createApp()).post(PETS).send(validPet())).status).toBe(401);
    expect((await createPetRequest(validPet(), await sessionCookie(adopter.id))).status).toBe(403);
  });
});

describe("T-12 CU-14 GET /api/shelter/pets", () => {
  it("CU-14: lists only the shelter's own pets, with their status", async () => {
    await createPetRequest(validPet());
    const other = await createShelter();
    await createPetRequest({ ...validPet(), name: "Ajena" }, await sessionCookie(other.id));

    const res = await request(createApp()).get(PETS).set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.pets).toEqual([expect.objectContaining({ name: "Txuri", status: "AVAILABLE", speciesName: "Perro" })]);
  });

  it("CU-14: a shelter without pets gets an empty list", async () => {
    const res = await request(createApp()).get(PETS).set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.pets).toEqual([]);
  });
});

describe("T-12 CU-16 GET and PUT /api/shelter/pets/:id", () => {
  it("CU-16: returns the pet's data to edit it", async () => {
    const { body } = await createPetRequest(validPet());

    const res = await request(createApp()).get(`${PETS}/${String(body.pet.id)}`).set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.pet).toMatchObject({ id: body.pet.id, name: "Txuri" });
  });

  it("CU-16, RN-208: edits the pet and records the old and new values in the audit log", async () => {
    const { body } = await createPetRequest(validPet());

    const res = await request(createApp())
      .put(`${PETS}/${String(body.pet.id)}`)
      .set("Cookie", cookie)
      .send({ ...validPet(), name: "Txuri Berri", getsAlongWith: [{ speciesId: catSpeciesId, getsAlong: true }] });

    expect(res.status).toBe(200);
    expect(res.body.pet).toMatchObject({ name: "Txuri Berri", getsAlongWith: [{ speciesId: catSpeciesId, getsAlong: true }] });
    const { rows } = await getPool().query(`SELECT action, actor_user_id, entity_type, entity_id, details FROM "Audit_log"`);
    expect(rows).toEqual([
      {
        action: "PET_UPDATED",
        actor_user_id: shelter.id,
        entity_type: "Pet",
        entity_id: body.pet.id,
        details: {
          before: { name: "Txuri", getsAlongWith: [{ speciesId: catSpeciesId, getsAlong: false }] },
          after: { name: "Txuri Berri", getsAlongWith: [{ speciesId: catSpeciesId, getsAlong: true }] },
        },
      },
    ]);
  });

  it("CU-16: rejects data with a wrong format and changes nothing", async () => {
    const { body } = await createPetRequest(validPet());

    const res = await request(createApp())
      .put(`${PETS}/${String(body.pet.id)}`)
      .set("Cookie", cookie)
      .send({ ...validPet(), name: "" });

    expect(res.status).toBe(400);
    const { rows } = await getPool().query(`SELECT name FROM "Pet"`);
    expect(rows).toEqual([{ name: "Txuri" }]);
  });

  it("CU-16: a shelter cannot see or edit another shelter's pet", async () => {
    const other = await createShelter();
    const { body } = await createPetRequest(validPet(), await sessionCookie(other.id));
    const path = `${PETS}/${String(body.pet.id)}`;

    expect((await request(createApp()).get(path).set("Cookie", cookie)).status).toBe(404);
    expect((await request(createApp()).put(path).set("Cookie", cookie).send(validPet())).status).toBe(404);
  });
});

describe("T-12 GET /api/breeds", () => {
  it("RN-39, RN-40: lists dogs and cats with their breeds, each with a mixed breed", async () => {
    const res = await request(createApp()).get("/api/breeds");

    expect(res.status).toBe(200);
    expect(res.body.species.map((s: { name: string }) => s.name)).toEqual(["Gato", "Perro"]);
    for (const species of res.body.species as { breeds: { name: string }[] }[]) {
      expect(species.breeds.map((b) => b.name)).toContain("Mestizo / Desconocida");
    }
  });
});
