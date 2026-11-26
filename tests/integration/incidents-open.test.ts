import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const URL = "/api/incidents";

let shelter: CreatedUser;
let adopter: CreatedUser;
let adopterCookie: string;
let shelterCookie: string;

const open = (body: object, as = adopterCookie) => request(createApp()).post(URL).set("Cookie", as).send(body);

async function visitBetween(adopterId: number, shelterId: number): Promise<number> {
  const pet = await createPet({ shelterId });
  const slot = await createVisitSlot({ shelterId });
  return (await createVisit({ adopterId, shelterId, petId: pet.id, slotId: slot.id })).id;
}

async function incidents(): Promise<Record<string, unknown>[]> {
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT reporter_id, reported_id, reason, description, visit_id, adoption_id, status FROM "Incident" ORDER BY id`,
  );
  return rows;
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter();
  adopter = await createAdopter();
  adopterCookie = await sessionCookie(adopter.id);
  shelterCookie = await sessionCookie(shelter.id);
});

describe("T-39 CU-36 POST /api/incidents", () => {
  it("CU-36, RN-165, RN-170: an adopter reports a shelter; the incident is OPEN and the shelter is not told", async () => {
    const res = await open({ reportedId: shelter.id, reason: "INAPPROPRIATE_BEHAVIOUR", description: "  Me trataron mal en la visita.  " });

    expect(res.status).toBe(201);
    expect(res.body.incident).toEqual({ id: expect.any(Number), status: "OPEN" });
    expect(await incidents()).toEqual([
      { reporter_id: adopter.id, reported_id: shelter.id, reason: "INAPPROPRIATE_BEHAVIOUR", description: "Me trataron mal en la visita.", visit_id: null, adoption_id: null, status: "OPEN" },
    ]);
    const { rowCount } = await getPool().query(`SELECT 1 FROM "Notification" WHERE user_id = $1`, [shelter.id]);
    expect(rowCount).toBe(0);
  });

  it("RN-165, RN-166: a shelter reports an adopter, linked to a visit between them", async () => {
    const visitId = await visitBetween(adopter.id, shelter.id);

    const res = await open({ reportedId: adopter.id, reason: "FALSE_INFORMATION", description: "Datos del hogar falsos.", visitId }, shelterCookie);

    expect(res.status).toBe(201);
    expect(await incidents()).toEqual([expect.objectContaining({ reporter_id: shelter.id, reported_id: adopter.id, visit_id: visitId })]);
  });

  it("CU-36: rejects a visit that does not belong to the two parties", async () => {
    const other = await createAdopter();
    const visitId = await visitBetween(other.id, shelter.id);

    const res = await open({ reportedId: shelter.id, reason: "WRONG_ATTENDANCE", description: "No falté a la visita.", visitId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("La visita o adopción indicada no es entre vosotros.");
    expect(await incidents()).toEqual([]);
  });

  it("RN-166: links to one visit or one adoption, not both", async () => {
    const visitId = await visitBetween(adopter.id, shelter.id);

    const res = await open({ reportedId: shelter.id, reason: "OTHER", description: "Algo", visitId, adoptionId: 1 });

    expect(res.status).toBe(400);
    expect(await incidents()).toEqual([]);
  });

  it("CU-36, RN-167: the explanation is required and the reason must be one of the list", async () => {
    for (const body of [
      { reportedId: shelter.id, reason: "OTHER" },
      { reportedId: shelter.id, reason: "OTHER", description: "   " },
      { reportedId: shelter.id, reason: "ANNOYED", description: "Algo" },
      { reason: "OTHER", description: "Algo" },
    ]) {
      expect((await open(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await incidents()).toEqual([]);
  });

  it("RN-165: the reported user must be of the other side (an adopter reports a shelter, and vice versa)", async () => {
    const otherAdopter = await createAdopter();
    const admin = await createAdmin();

    expect((await open({ reportedId: otherAdopter.id, reason: "OTHER", description: "Algo" })).status).toBe(404);
    expect((await open({ reportedId: admin.id, reason: "OTHER", description: "Algo" })).status).toBe(404);
    expect((await open({ reportedId: 999999, reason: "OTHER", description: "Algo" })).status).toBe(404);
    expect(await incidents()).toEqual([]);
  });

  it("CU-36: a session is required and only adopters and shelters open incidents", async () => {
    const adminCookie = await sessionCookie((await createAdmin()).id);
    const body = { reportedId: shelter.id, reason: "OTHER", description: "Algo" };

    expect((await request(createApp()).post(URL).send(body)).status).toBe(401);
    expect((await open(body, adminCookie)).status).toBe(403);
    expect(await incidents()).toEqual([]);
  });
});
