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

const get = async (path: string, userId: number) => request(createApp()).get(path).set("Cookie", await sessionCookie(userId));

/** An adoption of a new pet of `shelterId` by `adopterId`, with that status. */
async function adoption(status: "PENDING" | "APPROVED" | "COMPLETED" | "CANCELLED", adopterId = adopter.id, shelterId = shelter.id, petName = "Luna"): Promise<number> {
  const pet = await createPet({ shelterId, name: petName });
  const slot = await createVisitSlot({ shelterId, startsAt: new Date(Date.now() - 3 * DAY) });
  const visit = await createVisit({ adopterId, shelterId, petId: pet.id, slotId: slot.id, status: "CONFIRMED" });
  await getPool().query(`UPDATE "Visit" SET status = 'COMPLETED', attendance_marked_by = 'SYSTEM', attendance_marked_at = now() WHERE id = $1`, [visit.id]);
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO "Adoption" (adopter_id, pet_id, visit_id, questionnaire_answers, status, decided_at, delivered_at, cancelled_by, cancelled_at)
     VALUES ($1, $2, $3, '{}', $4, CASE WHEN $4 <> 'PENDING' THEN now() END, CASE WHEN $4 = 'COMPLETED' THEN now() END,
             CASE WHEN $4 = 'CANCELLED' THEN 'ADOPTER' END, CASE WHEN $4 = 'CANCELLED' THEN now() END) RETURNING id`,
    [adopterId, pet.id, visit.id, status],
  );
  return rows[0]?.id ?? 0;
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter({ name: "Huellas" });
  adopter = await createAdopter({ firstName: "Ane", lastName: "Etxeberria" });
});

describe("T-32 CU-21 GET /api/adopter/adoptions", () => {
  it("CU-21, CU-30: lists the adopter's adoptions with pet, shelter and status, newest first", async () => {
    const first = await adoption("CANCELLED", adopter.id, shelter.id, "Toby");
    const second = await adoption("APPROVED", adopter.id, shelter.id, "Luna");
    await adoption("PENDING", (await createAdopter()).id);

    const res = await get("/api/adopter/adoptions", adopter.id);

    expect(res.status).toBe(200);
    expect(res.body.adoptions).toEqual([
      { id: second, status: "APPROVED", petId: expect.any(Number), petName: "Luna", shelterName: "Huellas", requestedAt: expect.any(String) },
      { id: first, status: "CANCELLED", petId: expect.any(Number), petName: "Toby", shelterName: "Huellas", requestedAt: expect.any(String) },
    ]);
  });
});

describe("T-32 CU-22 GET /api/shelter/adoptions", () => {
  it("CU-22, CU-31, CU-32: lists the shelter's approved adoptions pending delivery and the completed ones", async () => {
    const approved = await adoption("APPROVED", adopter.id, shelter.id, "Luna");
    const completed = await adoption("COMPLETED", adopter.id, shelter.id, "Kira");
    await adoption("PENDING");
    await adoption("CANCELLED");
    await adoption("APPROVED", adopter.id, (await createShelter()).id);

    const res = await get("/api/shelter/adoptions", shelter.id);

    expect(res.status).toBe(200);
    expect(res.body.adoptions).toEqual([
      { id: approved, status: "APPROVED", petId: expect.any(Number), petName: "Luna", adopterId: adopter.id, adopterName: "Ane Etxeberria", deliveredAt: null },
      { id: completed, status: "COMPLETED", petId: expect.any(Number), petName: "Kira", adopterId: adopter.id, adopterName: "Ane Etxeberria", deliveredAt: expect.any(String) },
    ]);
  });

  it("CU-21, CU-22: each list needs a session and its role", async () => {
    const app = createApp();
    expect((await request(app).get("/api/adopter/adoptions")).status).toBe(401);
    expect((await request(app).get("/api/shelter/adoptions")).status).toBe(401);
    expect((await get("/api/adopter/adoptions", shelter.id)).status).toBe(403);
    expect((await get("/api/shelter/adoptions", adopter.id)).status).toBe(403);
  });
});
