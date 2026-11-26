import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getConfig } from "../../src/server/config.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let shelter: CreatedUser;
let adopter: CreatedUser;
let cookie: string;
let petId: number;

const replace = (visitId: number, slotId: number, as = cookie) =>
  request(createApp()).post(`/api/adopter/visits/${String(visitId)}/replace`).set("Cookie", as).send({ slotId });
const replacementSlots = (visitId: number, as = cookie) =>
  request(createApp()).get(`/api/adopter/visits/${String(visitId)}/replacement-slots`).set("Cookie", as);

/** A slot of the shelter starting `hours` from now. */
const slot = async (hours: number, capacity = 2) => (await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() + hours * HOUR), capacity })).id;

/**
 * A visit of the adopter to the pet that was voided: by default it was confirmed and its slot
 * was cancelled by the shelter (RN-111).
 */
async function voidedVisit(options: { confirmed?: boolean; reason?: string; pet?: number } = {}): Promise<number> {
  const slotId = await slot(5 * 24);
  const { id } = await createVisit({
    adopterId: adopter.id,
    shelterId: shelter.id,
    petId: options.pet ?? petId,
    slotId,
    status: options.confirmed === false ? "PENDING" : "CONFIRMED",
  });
  await getPool().query(`UPDATE "Visit" SET status = 'VOIDED', void_reason = $2, voided_at = now() WHERE id = $1`, [id, options.reason ?? "SLOT_CANCELLED"]);
  await getPool().query(`UPDATE "Visit_slot" SET cancelled_at = now() WHERE id = $1`, [slotId]);
  return id;
}

async function replacements(): Promise<{ pet_id: number; slot_id: number; status: string; replaces_visit_id: number; responded: boolean }[]> {
  const { rows } = await getPool().query<{ pet_id: number; slot_id: number; status: string; replaces_visit_id: number; responded: boolean }>(
    `SELECT pet_id, slot_id, status, replaces_visit_id, responded_at IS NOT NULL AS responded
       FROM "Visit" WHERE replaces_visit_id IS NOT NULL ORDER BY id`,
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

describe("T-49 CU-23 POST /api/adopter/visits/:id/replace", () => {
  it("RN-111, CU-23: a confirmed visit voided by a slot change is replaced by a visit for the same pet, confirmed at once and without the 48 h notice", async () => {
    const original = await voidedVisit();
    const hours = getConfig().rules.visitMinNoticeHours - 2;
    const slotId = await slot(hours);

    const res = await replace(original, slotId);

    expect(res.status).toBe(201);
    expect(res.body.visit).toMatchObject({ id: expect.any(Number), status: "CONFIRMED", petId, petName: "Luna" });
    expect(await replacements()).toEqual([{ pet_id: petId, slot_id: slotId, status: "CONFIRMED", replaces_visit_id: original, responded: true }]);
    const { rows: audits } = await getPool().query(`SELECT actor_user_id, action, details FROM "Audit_log" WHERE entity_id = $1 AND entity_type = 'Visit'`, [
      res.body.visit.id,
    ]);
    expect(audits).toEqual([{ actor_user_id: adopter.id, action: "VISIT_REQUESTED", details: { after: { status: "CONFIRMED", replacesVisitId: original } } }]);
  });

  it("RN-197: the replacement less than 48 h ahead gets its reminder at once", async () => {
    const original = await voidedVisit();
    expect((await replace(original, await slot(10))).status).toBe(201);
    const { rows } = await getPool().query(`SELECT type FROM "Notification" WHERE user_id = $1`, [adopter.id]);
    expect(rows).toEqual([{ type: "VISIT_REMINDER" }]);
  });

  it("RN-111: only a visit voided because of a slot change, which was confirmed, can be replaced", async () => {
    const pending = await voidedVisit({ confirmed: false });
    const reserved = await voidedVisit({ reason: "PET_RESERVED", pet: (await createPet({ shelterId: shelter.id })).id });
    const pet = (await createPet({ shelterId: shelter.id })).id;
    const active = (await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: pet, slotId: await slot(72), status: "CONFIRMED" })).id;
    const slotId = await slot(72);

    for (const id of [pending, reserved, active]) {
      const res = await replace(id, slotId);
      expect(res.status, String(id)).toBe(409);
      expect(res.body).toEqual({ error: "Esta visita no se puede sustituir por otra." });
    }
    expect(await replacements()).toEqual([]);
  });

  it("RN-111: a voided visit is replaced only once", async () => {
    const original = await voidedVisit();
    expect((await replace(original, await slot(72))).status).toBe(201);

    const res = await replace(original, await slot(96));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Ya has elegido otro turno para sustituir esta visita." });
    expect(await replacements()).toHaveLength(1);
  });

  it("CU-23: the slot has already started", async () => {
    const original = await voidedVisit();
    const started = (await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() - HOUR), durationMinutes: 120 })).id;
    const res = await replace(original, started);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Este turno ya ha empezado." });
  });

  it("RN-82, CU-23: the slot has no free places", async () => {
    const original = await voidedVisit();
    const full = await slot(72, 1);
    const other = await createAdopter();
    await createVisit({ adopterId: other.id, shelterId: shelter.id, petId: (await createPet({ shelterId: shelter.id })).id, slotId: full });
    expect((await replace(original, full)).status).toBe(409);
    expect(await replacements()).toEqual([]);
  });

  it("RN-88, CU-23: the shelter has blocked the adopter", async () => {
    const original = await voidedVisit();
    await getPool().query(`INSERT INTO "Block" (shelter_id, adopter_id, reason) VALUES ($1, $2, 'OTHER')`, [shelter.id, adopter.id]);
    expect((await replace(original, await slot(72))).status).toBe(403);
    expect(await replacements()).toEqual([]);
  });

  it("RN-89, CU-23: the adopter has a no-show at the shelter", async () => {
    const original = await voidedVisit();
    const past = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() - 3 * DAY) });
    const { id } = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: (await createPet({ shelterId: shelter.id })).id, slotId: past.id, status: "CONFIRMED" });
    await getPool().query(`UPDATE "Visit" SET status = 'NO_SHOW', attendance_marked_by = 'SHELTER', attendance_marked_at = now() WHERE id = $1`, [id]);
    expect((await replace(original, await slot(72))).status).toBe(403);
    expect(await replacements()).toEqual([]);
  });

  it("RN-90, CU-23: the adopter has the quota full at the shelter", async () => {
    const original = await voidedVisit();
    for (let i = 0; i < getConfig().rules.visitQuotaPerShelter; i++) {
      await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: (await createPet({ shelterId: shelter.id })).id, slotId: await slot(100 + i), status: "CONFIRMED" });
    }
    expect((await replace(original, await slot(72))).status).toBe(409);
    expect(await replacements()).toEqual([]);
  });

  it("CU-23: only the adopter of the visit can replace it", async () => {
    const original = await voidedVisit();
    const slotId = await slot(72);
    const other = await createAdopter();
    expect((await replace(original, slotId, await sessionCookie(other.id))).status).toBe(404);
    expect((await request(createApp()).post(`/api/adopter/visits/${String(original)}/replace`).send({ slotId })).status).toBe(401);
    expect((await replace(original, slotId, await sessionCookie(shelter.id))).status).toBe(403);
    expect((await replace(original, "x" as unknown as number)).status).toBe(400);
    expect(await replacements()).toEqual([]);
  });
});

describe("T-49 RN-111 GET /api/adopter/visits/:id/replacement-slots", () => {
  it("RN-111, RN-194: lists the free slots for the same pet, also those less than 48 h ahead", async () => {
    const original = await voidedVisit();
    const soon = await slot(5);
    const later = await slot(72);
    const full = await slot(30, 1);
    await createVisit({ adopterId: (await createAdopter()).id, shelterId: shelter.id, petId: (await createPet({ shelterId: shelter.id })).id, slotId: full });
    await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() - HOUR) });

    const res = await replacementSlots(original);

    expect(res.status).toBe(200);
    expect(res.body.slots.map((s: { id: number }) => s.id)).toEqual([soon, later]);
  });

  it("RN-111: a visit that cannot be replaced has no replacement slots", async () => {
    const pending = await voidedVisit({ confirmed: false });
    const res = await replacementSlots(pending);
    expect(res.status).toBe(409);
    const other = await createAdopter();
    expect((await replacementSlots(await voidedVisit(), await sessionCookie(other.id))).status).toBe(404);
  });
});
