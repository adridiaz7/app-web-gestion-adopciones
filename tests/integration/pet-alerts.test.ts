import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const DAY = 24 * 60 * 60 * 1000;

let shelter: CreatedUser;
let cookie: string;
let dogBreedId: number;
let catBreedId: number;

const post = (path: string, body: object = {}, as = cookie) => request(createApp()).post(path).set("Cookie", as).send(body);

function newPet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Txuri",
    breedId: dogBreedId,
    description: "Perra muy cariñosa.",
    birthDate: "2022-05-01",
    sex: "FEMALE",
    size: "MEDIUM",
    activityLevel: "MEDIUM",
    goodWithChildren: "YES",
    getsAlongWith: [],
    vaccinated: true,
    dewormed: true,
    sterilized: false,
    microchipped: true,
    specialNeeds: null,
    ...overrides,
  };
}

/** An adopter who filled in the questionnaire with these sizes ([] = "me da igual"). */
async function adopterWithPreferences(sizes: string[] = []): Promise<CreatedUser> {
  const adopter = await createAdopter();
  await getPool().query(`INSERT INTO "Adopter_preferences" (adopter_id, sizes) VALUES ($1, $2)`, [adopter.id, sizes]);
  return adopter;
}

async function favorite(adopterId: number, petId: number): Promise<void> {
  await getPool().query(`INSERT INTO adopter_pet_rel (adopter_id, pet_id, type) VALUES ($1, $2, 'FAVORITE')`, [adopterId, petId]);
}

async function sent(type: string): Promise<{ user_id: number; body: string; pet_id: number | null }[]> {
  const { rows } = await getPool().query<{ user_id: number; body: string; pet_id: number | null }>(
    `SELECT user_id, body, pet_id FROM "Notification" WHERE type = $1 ORDER BY user_id, id`,
    [type],
  );
  return rows;
}

/** An adoption of the pet by the adopter, enabled by a completed visit, with that status. */
async function adoption(adopterId: number, petId: number, status: "PENDING" | "APPROVED" | "NOT_SELECTED" | "REJECTED" | "COMPLETED"): Promise<number> {
  const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() - 3 * DAY) });
  const v = await createVisit({ adopterId, shelterId: shelter.id, petId, slotId: slot.id, status: "CONFIRMED" });
  await getPool().query(`UPDATE "Visit" SET status = 'COMPLETED', attendance_marked_by = 'SYSTEM', attendance_marked_at = now() WHERE id = $1`, [v.id]);
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO "Adoption" (adopter_id, pet_id, visit_id, questionnaire_answers, status, decided_at, delivered_at, rejection_reason)
     VALUES ($1, $2, $3, '{}', $4, CASE WHEN $4 <> 'PENDING' THEN now() END, CASE WHEN $4 = 'COMPLETED' THEN now() END,
             CASE WHEN $4 = 'REJECTED' THEN 'No encaja' END) RETURNING id`,
    [adopterId, petId, v.id, status],
  );
  if (status === "APPROVED") await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [petId]);
  if (status === "COMPLETED") await getPool().query(`UPDATE "Pet" SET status = 'ADOPTED' WHERE id = $1`, [petId]);
  return rows[0]?.id ?? 0;
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter({ name: "Refugio Esperanza" });
  cookie = await sessionCookie(shelter.id);
  const { rows } = await getPool().query<{ dog: number; cat: number }>(
    `SELECT (SELECT b.id FROM "Breed" b JOIN "Species" s ON s.id = b.species_id WHERE s.name = 'Perro' ORDER BY b.id LIMIT 1) AS dog,
            (SELECT b.id FROM "Breed" b JOIN "Species" s ON s.id = b.species_id WHERE s.name = 'Gato' ORDER BY b.id LIMIT 1) AS cat`,
  );
  dogBreedId = rows[0]?.dog ?? 0;
  catBreedId = rows[0]?.cat ?? 0;
});

describe("T-38 CU-54 new compatible pets", () => {
  it("RN-199, CU-54: a new available pet is announced to the compatible adopters with a questionnaire, and only to them", async () => {
    const compatible = await adopterWithPreferences(["MEDIUM"]);
    const anything = await adopterWithPreferences([]);
    await adopterWithPreferences(["SMALL"]);
    await createAdopter();

    const res = await post("/api/shelter/pets", newPet());

    expect(res.status).toBe(201);
    const alerts = await sent("NEW_COMPATIBLE_PET");
    expect(alerts.map((a) => a.user_id)).toEqual([compatible.id, anything.id]);
    expect(alerts[0]).toMatchObject({ pet_id: res.body.pet.id });
    expect(alerts[0]?.body).toContain("Txuri");
    expect(alerts[0]?.body).toContain("Refugio Esperanza");
  });

  it("RN-199, CU-54: adopters blocked by the shelter are not told", async () => {
    const blocked = await adopterWithPreferences();
    await getPool().query(`INSERT INTO "Block" (shelter_id, adopter_id, reason) VALUES ($1, $2, 'OTHER')`, [shelter.id, blocked.id]);

    expect((await post("/api/shelter/pets", newPet())).status).toBe(201);

    expect(await sent("NEW_COMPATIBLE_PET")).toEqual([]);
  });

  it("RN-199, RN-71: the species of the questionnaire counts too", async () => {
    const catLover = await createAdopter();
    await getPool().query(`INSERT INTO "Adopter_preferences" (adopter_id) VALUES ($1)`, [catLover.id]);
    await getPool().query(
      `INSERT INTO adopter_preferences_species_rel (adopter_id, species_id, is_wanted, must_get_along) SELECT $1, species_id, true, false FROM "Breed" WHERE id = $2`,
      [catLover.id, catBreedId],
    );

    expect((await post("/api/shelter/pets", newPet())).status).toBe(201);
    expect(await sent("NEW_COMPATIBLE_PET")).toEqual([]);

    expect((await post("/api/shelter/pets", newPet({ name: "Mizu", breedId: catBreedId }))).status).toBe(201);
    expect((await sent("NEW_COMPATIBLE_PET")).map((a) => a.user_id)).toEqual([catLover.id]);
  });

  it("RN-199, RN-23: the pets of a shelter pending validation are announced when it is validated", async () => {
    const pending = await createShelter({ validationStatus: "PENDING" });
    const adopter = await adopterWithPreferences();
    expect((await post("/api/shelter/pets", newPet(), await sessionCookie(pending.id))).status).toBe(201);
    expect(await sent("NEW_COMPATIBLE_PET")).toEqual([]);

    const adminCookie = await sessionCookie((await createAdmin()).id);
    expect((await post(`/api/admin/shelters/${String(pending.id)}/validate`, {}, adminCookie)).status).toBe(200);

    expect((await sent("NEW_COMPATIBLE_PET")).map((a) => a.user_id)).toEqual([adopter.id]);
  });

  it("RN-199, RN-200: a pet available again is announced as new to compatible adopters, and as a favourite change to those who have it in favourites", async () => {
    const pet = await createPet({ shelterId: shelter.id, name: "Luna", size: "MEDIUM" });
    const fan = await adopterWithPreferences();
    const other = await adopterWithPreferences();
    await favorite(fan.id, pet.id);
    expect((await post(`/api/shelter/pets/${String(pet.id)}/unlist`, { reason: "TREATMENT" })).status).toBe(200);

    expect((await post(`/api/shelter/pets/${String(pet.id)}/reactivate`)).status).toBe(200);

    expect((await sent("NEW_COMPATIBLE_PET")).map((a) => a.user_id)).toEqual([other.id]);
    const changes = await sent("FAVORITE_STATUS_CHANGED");
    expect(changes.map((a) => a.user_id)).toEqual([fan.id, fan.id]);
    expect(changes[0]?.body).toMatch(/Luna.*de baja/);
    expect(changes[1]?.body).toMatch(/Luna.*vuelve a estar disponible/);
  });
});

describe("T-38 CU-55 changes in the favourites", () => {
  it("RN-200, CU-55: approving an adoption tells the favourites that the pet is reserved, except the approved adopter", async () => {
    const pet = await createPet({ shelterId: shelter.id, name: "Luna" });
    const winner = await createAdopter();
    const fan = await createAdopter();
    await favorite(winner.id, pet.id);
    await favorite(fan.id, pet.id);
    const id = await adoption(winner.id, pet.id, "PENDING");

    expect((await post(`/api/shelter/adoptions/${String(id)}/approve`)).status).toBe(200);

    const changes = await sent("FAVORITE_STATUS_CHANGED");
    expect(changes).toEqual([{ user_id: fan.id, body: expect.stringMatching(/Luna.*reservada/), pet_id: pet.id }]);
  });

  it("RN-200, CU-55: registering the handover tells the favourites that the pet was adopted, except the adopter", async () => {
    const pet = await createPet({ shelterId: shelter.id, name: "Luna" });
    const winner = await createAdopter();
    const fan = await createAdopter();
    await favorite(winner.id, pet.id);
    await favorite(fan.id, pet.id);
    const id = await adoption(winner.id, pet.id, "APPROVED");

    expect((await post(`/api/shelter/adoptions/${String(id)}/deliver`)).status).toBe(200);

    expect(await sent("FAVORITE_STATUS_CHANGED")).toEqual([{ user_id: fan.id, body: expect.stringMatching(/Luna.*adoptada/), pet_id: pet.id }]);
  });

  it("RN-200, CU-55: when an approved adoption is cancelled, the favourites are told the pet is available again, except the adopters of that pet's adoptions", async () => {
    const pet = await createPet({ shelterId: shelter.id, name: "Luna" });
    const winner = await createAdopter();
    const loser = await createAdopter();
    const fan = await createAdopter();
    for (const a of [winner, loser, fan]) await favorite(a.id, pet.id);
    const id = await adoption(winner.id, pet.id, "APPROVED");
    await adoption(loser.id, pet.id, "NOT_SELECTED");

    expect((await post(`/api/shelter/adoptions/${String(id)}/cancel`, { reason: "No se ha presentado" })).status).toBe(200);

    expect((await sent("FAVORITE_STATUS_CHANGED")).map((a) => a.user_id)).toEqual([fan.id]);
    expect((await sent("PET_AVAILABLE_AGAIN")).map((a) => a.user_id)).toEqual([loser.id]);
  });

  it("RN-200: a return makes the pet available again for the favourites, except the adopter who returned it", async () => {
    const pet = await createPet({ shelterId: shelter.id, name: "Luna" });
    const owner = await createAdopter();
    const fan = await createAdopter();
    await favorite(owner.id, pet.id);
    await favorite(fan.id, pet.id);
    const id = await adoption(owner.id, pet.id, "COMPLETED");

    expect((await post(`/api/shelter/adoptions/${String(id)}/return`, { reason: "Alergia" })).status).toBe(200);

    expect(await sent("FAVORITE_STATUS_CHANGED")).toEqual([{ user_id: fan.id, body: expect.stringMatching(/Luna.*vuelve a estar disponible/), pet_id: pet.id }]);
  });

  it("RN-200: a discarded pet or another adopter's favourite does not count", async () => {
    const pet = await createPet({ shelterId: shelter.id, name: "Luna" });
    const discarder = await createAdopter();
    await getPool().query(`INSERT INTO adopter_pet_rel (adopter_id, pet_id, type) VALUES ($1, $2, 'DISCARDED')`, [discarder.id, pet.id]);

    expect((await post(`/api/shelter/pets/${String(pet.id)}/unlist`, { reason: "TREATMENT" })).status).toBe(200);

    expect(await sent("FAVORITE_STATUS_CHANGED")).toEqual([]);
  });
});

describe("T-38 review 26/11: only the adopters already told about the same change are left out", () => {
  it("RN-200: an adopter with an old rejected request who has the pet in favourites is told it is available again after a return", async () => {
    const pet = await createPet({ shelterId: shelter.id, name: "Luna" });
    const rejected = await createAdopter();
    const loser = await createAdopter();
    const owner = await createAdopter();
    for (const a of [rejected, loser, owner]) await favorite(a.id, pet.id);
    await adoption(rejected.id, pet.id, "REJECTED");
    await adoption(loser.id, pet.id, "NOT_SELECTED");
    const id = await adoption(owner.id, pet.id, "COMPLETED");

    expect((await post(`/api/shelter/adoptions/${String(id)}/return`, { reason: "Alergia" })).status).toBe(200);

    expect((await sent("FAVORITE_STATUS_CHANGED")).map((a) => a.user_id)).toEqual([rejected.id, loser.id]);
  });

  it("RN-200: approving an adoption tells an adopter with an old rejected request who has the pet in favourites, but not the candidates just not selected", async () => {
    const pet = await createPet({ shelterId: shelter.id, name: "Luna" });
    const winner = await createAdopter();
    const rejected = await createAdopter();
    const pending = await createAdopter();
    for (const a of [winner, rejected, pending]) await favorite(a.id, pet.id);
    await adoption(rejected.id, pet.id, "REJECTED");
    await adoption(pending.id, pet.id, "PENDING");
    const id = await adoption(winner.id, pet.id, "PENDING");

    expect((await post(`/api/shelter/adoptions/${String(id)}/approve`)).status).toBe(200);

    expect((await sent("FAVORITE_STATUS_CHANGED")).map((a) => a.user_id)).toEqual([rejected.id]);
    expect((await sent("ADOPTION_NOT_SELECTED")).map((a) => a.user_id)).toEqual([pending.id]);
  });

  it("RN-199: a compatible adopter with an old rejected request is told the pet is available again after a return", async () => {
    const pet = await createPet({ shelterId: shelter.id, name: "Luna", size: "MEDIUM" });
    const rejected = await adopterWithPreferences();
    const owner = await adopterWithPreferences();
    await adoption(rejected.id, pet.id, "REJECTED");
    const id = await adoption(owner.id, pet.id, "COMPLETED");

    expect((await post(`/api/shelter/adoptions/${String(id)}/return`, { reason: "Alergia" })).status).toBe(200);

    expect((await sent("NEW_COMPATIBLE_PET")).map((a) => a.user_id)).toEqual([rejected.id]);
  });
});
