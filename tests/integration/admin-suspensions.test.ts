import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const DAY = 24 * 60 * 60 * 1000;

let admin: CreatedUser;
let shelter: CreatedUser;
let adopter: CreatedUser;
let adminCookie: string;

const suspend = (userId: number, body: object = { reason: "FRAUD", detail: "Datos falsos" }, as = adminCookie) =>
  request(createApp()).post(`/api/admin/users/${String(userId)}/suspend`).set("Cookie", as).send(body);
const reactivate = (userId: number, as = adminCookie) => request(createApp()).post(`/api/admin/users/${String(userId)}/reactivate`).set("Cookie", as);

async function visit(status: "PENDING" | "CONFIRMED", petId: number, days = 5): Promise<number> {
  const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() + days * DAY) });
  return (await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId, slotId: slot.id, status })).id;
}

async function adoption(adopterId: number, petId: number, status: "PENDING" | "APPROVED" | "NOT_SELECTED"): Promise<number> {
  const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() - 3 * DAY) });
  const v = await createVisit({ adopterId, shelterId: shelter.id, petId, slotId: slot.id, status: "CONFIRMED" });
  await getPool().query(`UPDATE "Visit" SET status = 'COMPLETED', attendance_marked_by = 'SYSTEM', attendance_marked_at = now() WHERE id = $1`, [v.id]);
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO "Adoption" (adopter_id, pet_id, visit_id, questionnaire_answers, status, decided_at)
     VALUES ($1, $2, $3, '{}', $4, CASE WHEN $4 <> 'PENDING' THEN now() END) RETURNING id`,
    [adopterId, petId, v.id, status],
  );
  if (status === "APPROVED") await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [petId]);
  return rows[0]?.id ?? 0;
}

async function one<T>(sql: string, params: unknown[]): Promise<T> {
  const { rows } = await getPool().query(sql, params);
  return rows[0] as T;
}

const suspensions = async (userId: number) =>
  (await getPool().query(`SELECT reason, detail, ended_at IS NOT NULL AS ended FROM "Suspension" WHERE user_id = $1 ORDER BY id`, [userId])).rows;

beforeEach(async () => {
  await truncateAll();
  admin = await createAdmin();
  adminCookie = await sessionCookie(admin.id);
  shelter = await createShelter({ name: "Huellas" });
  adopter = await createAdopter();
});

describe("T-40 CU-40 POST /api/admin/users/:id/suspend", () => {
  it("RN-154, RN-155, RN-156, RN-208: suspends an adopter with a reason and detail, closes their sessions and audits it", async () => {
    const adopterCookie = await sessionCookie(adopter.id);

    const res = await suspend(adopter.id);

    expect(res.status).toBe(201);
    expect(res.body.suspension).toMatchObject({ id: expect.any(Number), userId: adopter.id, reason: "FRAUD", detail: "Datos falsos" });
    expect(await suspensions(adopter.id)).toEqual([{ reason: "FRAUD", detail: "Datos falsos", ended: false }]);
    expect((await request(createApp()).get("/api/auth/me").set("Cookie", adopterCookie)).status).toBe(401);
    const { rows } = await getPool().query(`SELECT actor_user_id, entity_type FROM "Audit_log" WHERE action = 'ACCOUNT_SUSPENDED'`);
    expect(rows).toEqual([{ actor_user_id: admin.id, entity_type: "Suspension" }]);
  });

  it("CU-40: the reason is required and must be one of RN-155", async () => {
    expect((await suspend(adopter.id, {})).status).toBe(400);
    expect((await suspend(adopter.id, { reason: "BORED" })).status).toBe(400);
    expect(await suspensions(adopter.id)).toEqual([]);
  });

  it("RN-156, CU-40: rejects a second active suspension", async () => {
    expect((await suspend(adopter.id)).status).toBe(201);

    const res = await suspend(adopter.id, { reason: "OTHER" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Esta cuenta ya está suspendida." });
    expect(await suspensions(adopter.id)).toHaveLength(1);
  });

  it("RN-158, RN-110: the adopter's open visits and pending adoptions are VOIDED (ADOPTER_SUSPENDED) and they are told", async () => {
    const luna = (await createPet({ shelterId: shelter.id, name: "Luna" })).id;
    const kira = (await createPet({ shelterId: shelter.id, name: "Kira" })).id;
    const pending = await visit("PENDING", luna);
    const confirmed = await visit("CONFIRMED", kira, 6);
    const pendingAdoption = await adoption(adopter.id, kira, "PENDING");

    expect((await suspend(adopter.id)).status).toBe(201);

    for (const id of [pending, confirmed]) {
      expect(await one(`SELECT status, void_reason FROM "Visit" WHERE id = $1`, [id])).toEqual({ status: "VOIDED", void_reason: "ADOPTER_SUSPENDED" });
    }
    expect(await one(`SELECT status, void_reason FROM "Adoption" WHERE id = $1`, [pendingAdoption])).toEqual({ status: "VOIDED", void_reason: "ADOPTER_SUSPENDED" });
    const { rows } = await getPool().query<{ type: string }>(`SELECT type FROM "Notification" WHERE user_id = $1 ORDER BY id`, [adopter.id]);
    expect(rows.map((r) => r.type)).toEqual(["VISIT_VOIDED_ADOPTER_SUSPENDED", "VISIT_VOIDED_ADOPTER_SUSPENDED", "ADOPTION_VOIDED_ADOPTER_SUSPENDED"]);
  });

  it("RN-158: an approved adoption is cancelled by the system, the pet is available again and the not-selected are told", async () => {
    const luna = (await createPet({ shelterId: shelter.id, name: "Luna" })).id;
    const approved = await adoption(adopter.id, luna, "APPROVED");
    const other = await createAdopter();
    await adoption(other.id, luna, "NOT_SELECTED");

    expect((await suspend(adopter.id)).status).toBe(201);

    expect(await one(`SELECT status, cancelled_by FROM "Adoption" WHERE id = $1`, [approved])).toEqual({ status: "CANCELLED", cancelled_by: "SYSTEM" });
    expect(await one(`SELECT status FROM "Pet" WHERE id = $1`, [luna])).toEqual({ status: "AVAILABLE" });
    const { rows } = await getPool().query<{ type: string }>(`SELECT type FROM "Notification" WHERE user_id = $1`, [other.id]);
    expect(rows.map((r) => r.type)).toContain("PET_AVAILABLE_AGAIN");
  });

  it("RN-157, RN-23: suspending a shelter keeps what is in progress, but its pets are no longer visible", async () => {
    const luna = (await createPet({ shelterId: shelter.id, name: "Luna" })).id;
    const confirmed = await visit("CONFIRMED", luna);

    expect((await suspend(shelter.id)).status).toBe(201);

    expect(await one(`SELECT status FROM "Visit" WHERE id = $1`, [confirmed])).toEqual({ status: "CONFIRMED" });
    const gallery = await request(createApp()).get("/api/pets");
    expect(JSON.stringify(gallery.body)).not.toContain("Luna");
  });

  it("RN-154: a suspended account cannot log in", async () => {
    await suspend(adopter.id);
    const { rows } = await getPool().query<{ n: number }>(`SELECT count(*)::int AS n FROM "Session" WHERE user_id = $1`, [adopter.id]);
    expect(rows[0]?.n).toBe(0);
  });

  it("CU-40: only adopters and shelters can be suspended; an unknown or deleted account answers 404", async () => {
    expect((await suspend(admin.id)).status).toBe(404);
    expect((await suspend(999_999)).status).toBe(404);
    await getPool().query(`UPDATE "App_user" SET deleted_at = now() WHERE id = $1`, [adopter.id]);
    expect((await suspend(adopter.id)).status).toBe(404);
  });

  it("CU-40: only the administrator suspends, and a session is required", async () => {
    expect((await request(createApp()).post(`/api/admin/users/${String(adopter.id)}/suspend`).send({ reason: "FRAUD" })).status).toBe(401);
    expect((await suspend(adopter.id, { reason: "FRAUD" }, await sessionCookie(shelter.id))).status).toBe(403);
    expect((await suspend(shelter.id, { reason: "FRAUD" }, await sessionCookie(adopter.id))).status).toBe(403);
    expect(await suspensions(adopter.id)).toEqual([]);
  });
});

describe("T-40 CU-40 POST /api/admin/users/:id/reactivate", () => {
  it("RN-156, RN-208: reactivates a suspended account; the suspension stays in the history with its end", async () => {
    await suspend(adopter.id);

    const res = await reactivate(adopter.id);

    expect(res.status).toBe(204);
    expect(await suspensions(adopter.id)).toEqual([{ reason: "FRAUD", detail: "Datos falsos", ended: true }]);
    const { rows } = await getPool().query(`SELECT action FROM "Audit_log" WHERE action = 'ACCOUNT_REACTIVATED'`);
    expect(rows).toHaveLength(1);
    // It can be suspended again later.
    expect((await suspend(adopter.id, { reason: "OTHER" })).status).toBe(201);
  });

  it("CU-40: rejects reactivating an account without an active suspension", async () => {
    const res = await reactivate(adopter.id);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Esta cuenta no está suspendida." });
  });

  it("CU-40: only the administrator reactivates", async () => {
    await suspend(adopter.id);
    expect((await request(createApp()).post(`/api/admin/users/${String(adopter.id)}/reactivate`)).status).toBe(401);
    expect((await reactivate(adopter.id, await sessionCookie(shelter.id))).status).toBe(403);
    expect(await suspensions(adopter.id)).toEqual([{ reason: "FRAUD", detail: "Datos falsos", ended: false }]);
  });

  it("RN-199, RN-23: reactivating a suspended shelter announces its available pets to compatible adopters", async () => {
    const luna = (await createPet({ shelterId: shelter.id, name: "Luna" })).id;
    const kira = (await createPet({ shelterId: shelter.id, name: "Kira" })).id;
    await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [kira]);
    await getPool().query(`INSERT INTO "Adopter_preferences" (adopter_id) VALUES ($1)`, [adopter.id]);
    await suspend(shelter.id);

    expect((await reactivate(shelter.id)).status).toBe(204);

    const { rows } = await getPool().query(`SELECT user_id, pet_id FROM "Notification" WHERE type = 'NEW_COMPATIBLE_PET'`);
    expect(rows).toEqual([{ user_id: adopter.id, pet_id: luna }]);
  });
});

describe("T-40 CU-40 GET /api/admin/users", () => {
  it("CU-40: lists adopters and shelters with their active suspension, searchable by name or email", async () => {
    await suspend(shelter.id, { reason: "OTHER" });

    const all = await request(createApp()).get("/api/admin/users").set("Cookie", adminCookie);
    expect(all.status).toBe(200);
    expect(all.body.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: adopter.id, role: "ADOPTER", email: adopter.email, suspension: null }),
        expect.objectContaining({ id: shelter.id, role: "SHELTER", name: "Huellas", suspension: expect.objectContaining({ reason: "OTHER" }) }),
      ]),
    );
    expect(all.body.users.map((u: { id: number }) => u.id)).not.toContain(admin.id);

    const found = await request(createApp()).get("/api/admin/users?q=huel").set("Cookie", adminCookie);
    expect(found.body.users.map((u: { id: number }) => u.id)).toEqual([shelter.id]);
    expect((await request(createApp()).get("/api/admin/users").set("Cookie", await sessionCookie(adopter.id))).status).toBe(403);
  });
});
