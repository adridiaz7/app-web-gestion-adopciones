import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const DAY = 24 * 60 * 60 * 1000;

let shelter: CreatedUser;
let adopter: CreatedUser;
let cookie: string;
let petId: number;

const household = {
  housingType: "HOUSE",
  hasOutdoorSpace: true,
  housingTenure: "OWNED",
  householdMembers: 2,
  hasChildren: false,
  hasOtherPets: false,
  otherPetsDescription: null,
  hasPetExperience: true,
  hoursAlonePerDay: 3,
};

const eligibility = (as = cookie, pet = petId) => request(createApp()).get(`/api/adopter/pets/${String(pet)}/adoption-eligibility`).set("Cookie", as);
const apply = () => request(createApp()).post("/api/adopter/adoptions").set("Cookie", cookie).send({ petId, household, answers: {} });

/** A visit of the adopter to the pet, in a slot that started `daysAgo` days ago, with that status. */
async function visit(daysAgo: number, status: "COMPLETED" | "NO_SHOW" | "CONFIRMED" = "COMPLETED", pet = petId): Promise<number> {
  const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() - daysAgo * DAY) });
  const { id } = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: pet, slotId: slot.id, status: "CONFIRMED" });
  if (status !== "CONFIRMED") {
    await getPool().query(`UPDATE "Visit" SET status = $2, attendance_marked_by = 'SYSTEM', attendance_marked_at = now() WHERE id = $1`, [id, status]);
  }
  return id;
}

/** T-52: the eligibility answer and the real request agree (the same check, not a copy). */
async function expectRequestTo(succeed: boolean): Promise<void> {
  const res = await apply();
  expect(res.status < 300).toBe(succeed);
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter({ name: "Huellas" });
  adopter = await createAdopter();
  cookie = await sessionCookie(adopter.id);
  petId = (await createPet({ shelterId: shelter.id, name: "Luna" })).id;
});

describe("T-52 GET /api/adopter/pets/:id/adoption-eligibility", () => {
  it("RN-113, RN-116: with a recent completed visit the adopter can request the adoption", async () => {
    await visit(3);

    const res = await eligibility();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ eligibility: { canRequest: true, reason: null, message: null } });
    await expectRequestTo(true);
  });

  it("RN-117: missing household data do not count, because they are filled in on the form", async () => {
    await visit(3);
    const { rows } = await getPool().query<{ housing_type: string | null }>(`SELECT housing_type FROM "Adopter" WHERE user_id = $1`, [adopter.id]);
    expect(rows[0]?.housing_type).toBeNull();

    expect((await eligibility()).body.eligibility.canRequest).toBe(true);
  });

  it("RN-113, CU-27: without a completed visit to that pet, the adopter cannot request it and is told to visit first", async () => {
    await visit(3, "CONFIRMED");
    const other = await createPet({ shelterId: shelter.id });
    await visit(3, "COMPLETED", other.id);

    const res = await eligibility();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      eligibility: { canRequest: false, reason: "NO_VISIT", message: "Para solicitar la adopción, primero tienes que visitar a Luna." },
    });
    await expectRequestTo(false);
  });

  it("RN-116, CU-27: a visit more than 1 month ago no longer counts", async () => {
    await visit(32);

    const res = await eligibility();

    expect(res.body).toEqual({
      eligibility: {
        canRequest: false,
        reason: "VISIT_EXPIRED",
        message: "Tu visita a Luna fue hace más de un mes: pide otra visita para poder adoptarla.",
      },
    });
    await expectRequestTo(false);
  });

  it("RN-119, CU-27: with an open request for the pet, the adopter is told it is already requested", async () => {
    await visit(3);
    await expectRequestTo(true);

    const res = await eligibility();

    expect(res.body).toEqual({ eligibility: { canRequest: false, reason: "OPEN_REQUEST", message: "Ya has solicitado adoptar a Luna." } });
  });

  it("RN-118, CU-27: a no-show at the shelter prevents the request", async () => {
    await visit(3);
    const other = await createPet({ shelterId: shelter.id });
    await visit(5, "NO_SHOW", other.id);

    const res = await eligibility();

    expect(res.body.eligibility).toEqual({
      canRequest: false,
      reason: "NO_SHOW",
      message: "No puedes solicitar adopciones en esta protectora porque no acudiste a una visita confirmada.",
    });
    await expectRequestTo(false);
  });

  it("RN-118, RN-149: a block prevents the request, with the neutral text and the end date", async () => {
    await visit(3);
    await getPool().query(`INSERT INTO "Block" (shelter_id, adopter_id, reason, ends_at) VALUES ($1, $2, 'OTHER', '2099-03-15T12:00:00Z')`, [
      shelter.id,
      adopter.id,
    ]);

    const res = await eligibility();

    expect(res.body.eligibility).toEqual({
      canRequest: false,
      reason: "BLOCKED",
      message: "La protectora Huellas ha restringido tu acceso a sus mascotas hasta el 15 de marzo de 2099.",
    });
    expect(res.body.eligibility.message).not.toMatch(/bloque/i);
    await expectRequestTo(false);
  });

  it("CU-27: a pet that is no longer available cannot be requested", async () => {
    await visit(3);
    await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [petId]);

    const res = await eligibility();

    expect(res.body.eligibility).toEqual({ canRequest: false, reason: "NOT_AVAILABLE", message: "Esta mascota no está disponible." });
    await expectRequestTo(false);
  });

  it("CU-11: an unknown pet, or one of a shelter that is not validated, answers 404", async () => {
    expect((await eligibility(cookie, 999_999)).status).toBe(404);
    const pending = await createShelter({ validationStatus: "PENDING" });
    const hidden = await createPet({ shelterId: pending.id });
    expect((await eligibility(cookie, hidden.id)).status).toBe(404);
    expect((await eligibility(cookie, Number.NaN)).status).toBe(400);
  });

  it("CU-27: only adopters ask, and a session is required", async () => {
    expect((await request(createApp()).get(`/api/adopter/pets/${String(petId)}/adoption-eligibility`)).status).toBe(401);
    expect((await eligibility(await sessionCookie(shelter.id))).status).toBe(403);
    expect((await eligibility(await sessionCookie((await createAdmin()).id))).status).toBe(403);
  });
});
