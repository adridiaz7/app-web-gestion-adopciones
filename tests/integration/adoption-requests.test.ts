import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const DAY = 24 * 60 * 60 * 1000;

let shelter: CreatedUser;
let adopter: CreatedUser;
let cookie: string;
let petId: number;

const household = {
  housingType: "APARTMENT",
  hasOutdoorSpace: true,
  housingTenure: "RENT_TO_OWN",
  householdMembers: 3,
  hasChildren: true,
  hasOtherPets: true,
  otherPetsDescription: "Un gato de 4 años",
  hasPetExperience: true,
  hoursAlonePerDay: 4,
};

const apply = (body: object, as = cookie) => request(createApp()).post("/api/adopter/adoptions").set("Cookie", as).send(body);
const validBody = (overrides: object = {}) => ({ petId, household, answers: { reason: "Nos enamoramos de Luna en la visita.", canAffordCosts: true }, ...overrides });

/** A visit of the adopter to the pet, in a slot that started `daysAgo` days ago, with that status. */
async function visit(daysAgo: number, status: "COMPLETED" | "NO_SHOW" | "CONFIRMED" = "COMPLETED", pet = petId): Promise<number> {
  const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() - daysAgo * DAY) });
  const { id } = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: pet, slotId: slot.id, status: "CONFIRMED" });
  if (status !== "CONFIRMED") {
    await getPool().query(
      `UPDATE "Visit" SET status = $2, attendance_marked_by = 'SYSTEM', attendance_marked_at = now() WHERE id = $1`,
      [id, status],
    );
  }
  return id;
}

async function adoptions(): Promise<{ adopter_id: number; pet_id: number; visit_id: number; status: string; questionnaire_answers: unknown }[]> {
  const { rows } = await getPool().query<{ adopter_id: number; pet_id: number; visit_id: number; status: string; questionnaire_answers: unknown }>(
    `SELECT adopter_id, pet_id, visit_id, status, questionnaire_answers FROM "Adoption" ORDER BY id`,
  );
  return rows;
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter();
  adopter = await createAdopter();
  cookie = await sessionCookie(adopter.id);
  petId = (await createPet({ shelterId: shelter.id, name: "Luna" })).id;
});

describe("T-30 CU-27 POST /api/adopter/adoptions", () => {
  it("RN-113, RN-114, RN-207, CU-27: requests the adoption of a visited pet; it stays pending, linked to the visit, with the answers", async () => {
    const visitId = await visit(3);

    const res = await apply(validBody());

    expect(res.status).toBe(201);
    expect(res.body.adoption).toMatchObject({ id: expect.any(Number), status: "PENDING", petId, petName: "Luna" });
    expect(await adoptions()).toEqual([
      {
        adopter_id: adopter.id,
        pet_id: petId,
        visit_id: visitId,
        status: "PENDING",
        questionnaire_answers: { reason: "Nos enamoramos de Luna en la visita.", canAffordCosts: true },
      },
    ]);
    const { rows } = await getPool().query(`SELECT action, entity_id FROM "Audit_log" WHERE entity_type = 'Adoption'`);
    expect(rows).toEqual([{ action: "ADOPTION_REQUESTED", entity_id: res.body.adoption.id }]);
  });

  it("RN-207, RN-27: the household data are saved in the adopter's profile, including RENT_TO_OWN", async () => {
    await visit(3);

    expect((await apply(validBody())).status).toBe(201);

    const res = await request(createApp()).get("/api/adopter/household").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.household).toEqual(household);
  });

  it("RN-207: the two questions are optional", async () => {
    await visit(3);

    const res = await apply(validBody({ answers: {} }));

    expect(res.status).toBe(201);
    expect((await adoptions())[0]?.questionnaire_answers).toEqual({});
  });

  it("RN-117, CU-27: the household data are required, and nothing is saved without them", async () => {
    await visit(3);
    for (const missing of Object.keys(household).filter((key) => key !== "otherPetsDescription")) {
      const incomplete = Object.fromEntries(Object.entries(household).filter(([key]) => key !== missing));
      const res = await apply(validBody({ household: incomplete }));
      expect(res.status, missing).toBe(400);
    }
    expect(await adoptions()).toEqual([]);
    const after = await request(createApp()).get("/api/adopter/household").set("Cookie", cookie);
    expect(after.body.household.housingType).toBeNull();
  });

  it("RN-113, CU-27: rejects the request without a completed visit to that pet", async () => {
    await visit(3, "CONFIRMED");
    const other = await createPet({ shelterId: shelter.id });
    await visit(3, "COMPLETED", other.id);

    const res = await apply(validBody());

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Para solicitar la adopción tienes que haber visitado antes a Luna." });
    expect(await adoptions()).toEqual([]);
  });

  it("RN-116, CU-27: a visit more than 1 month ago no longer counts", async () => {
    await visit(32);

    const res = await apply(validBody());

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Tu visita a Luna fue hace más de 1 mes. Para solicitar la adopción, haz otra visita." });
  });

  it("RN-115: the same visit serves again after a cancelled or rejected request", async () => {
    const visitId = await visit(3);
    await getPool().query(
      `INSERT INTO "Adoption" (adopter_id, pet_id, visit_id, questionnaire_answers, status, cancelled_by, cancelled_at)
       VALUES ($1, $2, $3, '{}', 'CANCELLED', 'ADOPTER', now())`,
      [adopter.id, petId, visitId],
    );

    expect((await apply(validBody())).status).toBe(201);
  });

  it("RN-119, CU-27: rejects a second open request for the same pet", async () => {
    await visit(3);
    expect((await apply(validBody())).status).toBe(201);

    const res = await apply(validBody());

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Ya tienes una solicitud de adopción abierta para Luna." });
    expect(await adoptions()).toHaveLength(1);
  });

  it("RN-118, CU-27: an adopter with a no-show at the shelter cannot request an adoption", async () => {
    await visit(3);
    const other = await createPet({ shelterId: shelter.id });
    await visit(5, "NO_SHOW", other.id);

    const res = await apply(validBody());

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "No puedes solicitar adopciones en esta protectora porque no acudiste a una visita confirmada." });
  });

  it("RN-118, CU-27: an adopter blocked by the shelter cannot request an adoption", async () => {
    await visit(3);
    await getPool().query(`INSERT INTO "Block" (shelter_id, adopter_id, reason, ends_at) VALUES ($1, $2, 'OTHER', NULL)`, [shelter.id, adopter.id]);

    const res = await apply(validBody());

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/ha restringido tu acceso/);
    expect(await adoptions()).toEqual([]);
  });

  it("CU-27: the pet is not available", async () => {
    await visit(3);
    await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [petId]);

    const res = await apply(validBody());

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Esta mascota no está disponible." });
  });

  it("CU-27: only adopters can request, and the input format is checked", async () => {
    expect((await apply(validBody(), await sessionCookie(shelter.id))).status).toBe(403);
    expect((await request(createApp()).post("/api/adopter/adoptions").send(validBody())).status).toBe(401);
    expect((await apply(validBody({ petId: "x" }))).status).toBe(400);
    expect((await apply(validBody({ answers: { reason: "x".repeat(2001) } }))).status).toBe(400);
    expect((await apply(validBody({ household: { ...household, hoursAlonePerDay: 25 } }))).status).toBe(400);
    expect((await apply(validBody({ household: { ...household, housingTenure: "LEASED" } }))).status).toBe(400);
  });
});

describe("T-30 RN-207 GET /api/adopter/household", () => {
  it("RN-27: returns the household data of the profile, empty until filled in", async () => {
    const res = await request(createApp()).get("/api/adopter/household").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.household).toEqual({
      housingType: null,
      hasOutdoorSpace: null,
      housingTenure: null,
      householdMembers: null,
      hasChildren: null,
      hasOtherPets: null,
      otherPetsDescription: null,
      hasPetExperience: null,
      hoursAlonePerDay: null,
    });
  });
});
