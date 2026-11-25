import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, type CreatedUser } from "../helpers/factories.js";

let shelter: CreatedUser;
let adopter: CreatedUser;
let cookie: string;
let petId: number;

const profile = (id: number, as: string | null = cookie) => {
  const req = request(createApp()).get(`/api/pets/${String(id)}`);
  return as ? req.set("Cookie", as) : req;
};

async function expectNotVisible(id = petId, as: string | null = cookie): Promise<void> {
  const res = await profile(id, as);
  expect(res.status).toBe(404);
  expect(res.body.error).toBe("Esta mascota no está disponible.");
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter({ name: "Huellas", provinceId: 46 });
  adopter = await createAdopter();
  cookie = await sessionCookie(adopter.id);
  petId = (await createPet({ shelterId: shelter.id, name: "Luna", birthDate: "2022-03-04", sex: "FEMALE", size: "LARGE", activityLevel: "HIGH" })).id;
});

describe("T-15 CU-11 GET /api/pets/:id", () => {
  it("CU-11: shows the whole profile: photos in order, data, living with others, health and shelter", async () => {
    const pool = getPool();
    await pool.query(
      `UPDATE "Pet" SET description = 'Muy cariñosa.', good_with_children = 'YES', special_needs = 'Dieta blanda',
                        microchipped = false WHERE id = $1`,
      [petId],
    );
    await pool.query(`INSERT INTO "Pet_photo" (pet_id, path, position) VALUES ($1, '/uploads/2.png', 2), ($1, '/uploads/1.png', 1)`, [petId]);
    await pool.query(
      `INSERT INTO pet_species_rel (pet_id, species_id, gets_along)
       SELECT $1, id, name = 'Perro' FROM "Species"`,
      [petId],
    );

    const res = await profile(petId);
    expect(res.status).toBe(200);
    expect(res.body.pet).toEqual({
      id: petId,
      name: "Luna",
      description: "Muy cariñosa.",
      speciesName: expect.any(String),
      breedName: expect.any(String),
      birthDate: "2022-03-04",
      sex: "FEMALE",
      size: "LARGE",
      activityLevel: "HIGH",
      goodWithChildren: "YES",
      getsAlongWith: [
        { speciesName: "Gato", getsAlong: false },
        { speciesName: "Perro", getsAlong: true },
      ],
      vaccinated: true,
      dewormed: true,
      sterilized: true,
      microchipped: false,
      specialNeeds: "Dieta blanda",
      photos: [
        { id: expect.any(Number), url: "/uploads/1.png", position: 1 },
        { id: expect.any(Number), url: "/uploads/2.png", position: 2 },
      ],
      shelter: { id: shelter.id, name: "Huellas", locality: "Donostia", provinceName: "Valencia/València" },
    });
  });

  it("RN-46: a species without a record is left out (unknown)", async () => {
    const res = await profile(petId);
    expect(res.body.pet.getsAlongWith).toEqual([]);
    expect(res.body.pet.photos).toEqual([]);
  });

  it("RN-188, CU-11: without a session the profile is not available", async () => {
    const res = await profile(petId, null);
    expect(res.status).toBe(401);
  });

  it("RN-58, CU-11: a pet that is not available cannot be seen", async () => {
    await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [petId]);
    await expectNotVisible();
  });

  it("RN-77, CU-11: the shelter has blocked the adopter", async () => {
    await getPool().query(`INSERT INTO "Block" (shelter_id, adopter_id, reason) VALUES ($1, $2, 'OTHER')`, [shelter.id, adopter.id]);
    await expectNotVisible();
  });

  it("RN-23, CU-11: the shelter is not validated", async () => {
    await getPool().query(`UPDATE "Shelter" SET validation_status = 'REJECTED', validation_reason = 'Revocada' WHERE user_id = $1`, [shelter.id]);
    await expectNotVisible();
  });

  it("RN-23, CU-11: the shelter is suspended", async () => {
    await getPool().query(`INSERT INTO "Suspension" (user_id, reason) VALUES ($1, 'OTHER')`, [shelter.id]);
    await expectNotVisible();
  });

  it("CU-11: a pet that does not exist", async () => {
    await expectNotVisible(petId + 1000);
  });

  it("CU-11: rejects a malformed id", async () => {
    const res = await request(createApp()).get("/api/pets/abc").set("Cookie", cookie);
    expect(res.status).toBe(400);
  });
});
