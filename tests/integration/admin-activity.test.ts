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

const get = (url: string, as = cookie) => request(createApp()).get(`/api/admin${url}`).set("Cookie", as);

async function log(actor: number | null, action: string, entityType: string, entityId: number, details: object = {}): Promise<void> {
  await getPool().query(`INSERT INTO "Audit_log" (actor_user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)`, [
    actor,
    action,
    entityType,
    entityId,
    JSON.stringify(details),
  ]);
}

beforeEach(async () => {
  await truncateAll();
  cookie = await sessionCookie((await createAdmin()).id);
  shelter = await createShelter({ name: "Huellas" });
  adopter = await createAdopter();
});

describe("T-41 CU-43 GET /api/admin/audit-log", () => {
  it("RN-161, RN-208: the history of a visit, oldest first, with who did each action and what changed", async () => {
    await log(adopter.id, "VISIT_REQUESTED", "Visit", 7, { after: { status: "PENDING" } });
    await log(shelter.id, "VISIT_CONFIRMED", "Visit", 7, { before: { status: "PENDING" }, after: { status: "CONFIRMED" } });
    await log(shelter.id, "VISIT_CONFIRMED", "Visit", 8);

    const res = await get("/audit-log?entityType=Visit&entityId=7");

    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([
      expect.objectContaining({ action: "VISIT_REQUESTED", actor: { id: adopter.id, email: adopter.email, role: "ADOPTER" }, details: { after: { status: "PENDING" } } }),
      expect.objectContaining({ action: "VISIT_CONFIRMED", actor: { id: shelter.id, email: shelter.email, role: "SHELTER" } }),
    ]);
    expect(res.body.entries[0].createdAt).toEqual(expect.any(String));
  });

  it("CU-43: filters by actor (for example, a shelter that blocks abusively), newest first; system actions have no actor", async () => {
    await log(shelter.id, "ADOPTER_BLOCKED", "Block", 1);
    await log(shelter.id, "ADOPTER_BLOCKED", "Block", 2);
    await log(null, "ADOPTER_UNBLOCKED", "Block", 1);

    const byActor = await get(`/audit-log?actorId=${String(shelter.id)}`);
    expect(byActor.body.entries.map((e: { entityId: number }) => e.entityId)).toEqual([2, 1]);

    const all = await get("/audit-log?entityType=Block");
    expect(all.body.entries.map((e: { actor: unknown }) => e.actor)).toContainEqual(null);
  });

  it("CU-43: the filters are checked", async () => {
    expect((await get("/audit-log?entityId=abc")).status).toBe(400);
    expect((await get("/audit-log?entityType=Visit;DROP")).status).toBe(400);
  });

  it("RN-161: only the administrator, and a session is required", async () => {
    expect((await request(createApp()).get("/api/admin/audit-log")).status).toBe(401);
    expect((await get("/audit-log", await sessionCookie(shelter.id))).status).toBe(403);
    expect((await get("/audit-log", await sessionCookie(adopter.id))).status).toBe(403);
  });
});

describe("T-41 CU-44 GET /api/admin/stats", () => {
  it("RN-160: global indicators of adoptions, average handling times, returns, blocks, incidents and visits", async () => {
    const pets = await Promise.all([1, 2, 3].map((n) => createPet({ shelterId: shelter.id, name: `M${String(n)}` })));
    const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() - 10 * DAY) });
    const visits = [];
    for (const pet of pets) {
      const v = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: pet.id, slotId: slot.id, status: "CONFIRMED" });
      await getPool().query(`UPDATE "Visit" SET status = 'COMPLETED', attendance_marked_by = 'SYSTEM', attendance_marked_at = now() WHERE id = $1`, [v.id]);
      visits.push(v.id);
    }
    // Completed: requested 6 days ago, decided 2 days later, delivered 4 days after that.
    await getPool().query(
      `INSERT INTO "Adoption" (adopter_id, pet_id, visit_id, questionnaire_answers, status, created_at, decided_at, delivered_at) VALUES
         ($1, $2, $3, '{}', 'COMPLETED', now() - interval '6 days', now() - interval '4 days', now()),
         ($1, $4, $5, '{}', 'COMPLETED', now() - interval '6 days', now() - interval '2 days', now() - interval '1 day'),
         ($1, $6, $7, '{}', 'PENDING',   now(), NULL, NULL)`,
      [adopter.id, pets[0]?.id, visits[0], pets[1]?.id, visits[1], pets[2]?.id, visits[2]],
    );
    await getPool().query(`UPDATE "Adoption" SET status = 'RETURNED', returned_at = now(), return_reason = 'Alergia' WHERE pet_id = $1`, [pets[1]?.id]);
    await getPool().query(`INSERT INTO "Block" (shelter_id, adopter_id, reason, ends_at) VALUES ($1, $2, 'OTHER', NULL)`, [shelter.id, adopter.id]);

    const res = await get("/stats");

    expect(res.status).toBe(200);
    expect(res.body.stats).toEqual({
      adoptions: { pending: 1, approved: 0, completed: 1, returned: 1, rejected: 0, cancelled: 0 },
      averageDaysToDecide: 3,
      averageDaysToDeliver: 2.5,
      visits: { completed: 3, noShow: 0 },
      blocks: { active: 1, total: 1 },
      incidents: { open: 0, total: 0 },
    });
  });

  it("RN-160: with no data the averages are null", async () => {
    const res = await get("/stats");
    expect(res.body.stats.averageDaysToDecide).toBeNull();
    expect(res.body.stats.adoptions.completed).toBe(0);
  });

  it("RN-160: only the administrator", async () => {
    expect((await request(createApp()).get("/api/admin/stats")).status).toBe(401);
    expect((await get("/stats", await sessionCookie(shelter.id))).status).toBe(403);
  });
});
