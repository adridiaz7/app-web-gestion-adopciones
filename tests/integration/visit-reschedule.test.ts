import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
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

const reschedule = (visitId: number | string, body: object, as = cookie) =>
  request(createApp()).post(`/api/adopter/visits/${String(visitId)}/reschedule`).set("Cookie", as).send(body);

const slot = async (options: { startsAt?: Date; capacity?: number; shelterId?: number } = {}) =>
  (await createVisitSlot({ shelterId: options.shelterId ?? shelter.id, startsAt: options.startsAt ?? new Date(Date.now() + 7 * DAY), capacity: options.capacity ?? 2 })).id;

/** The adopter's visit to `petId` in a new slot starting at `startsAt`. */
async function original(status: "PENDING" | "CONFIRMED" = "CONFIRMED", startsAt = new Date(Date.now() + 5 * DAY)): Promise<number> {
  const slotId = await slot({ startsAt });
  return (await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId, slotId, status })).id;
}

interface Row {
  id: number;
  status: string;
  cancelled_by: string | null;
  slot_id: number;
  pet_id: number;
  replaces_visit_id: number | null;
}

async function visits(): Promise<Row[]> {
  const { rows } = await getPool().query<Row>(`SELECT id, status, cancelled_by, slot_id, pet_id, replaces_visit_id FROM "Visit" ORDER BY id`);
  return rows;
}

async function notifications(): Promise<{ user_id: number; type: string; body: string; visit_id: number | null }[]> {
  const { rows } = await getPool().query<{ user_id: number; type: string; body: string; visit_id: number | null }>(
    `SELECT user_id, type, body, visit_id FROM "Notification" ORDER BY id`,
  );
  return rows;
}

async function auditActions(): Promise<{ action: string; entity_id: number; actor_user_id: number }[]> {
  const { rows } = await getPool().query<{ action: string; entity_id: number; actor_user_id: number }>(
    `SELECT action, entity_id, actor_user_id FROM "Audit_log" WHERE entity_type = 'Visit' ORDER BY id`,
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

describe("T-26 CU-51 POST /api/adopter/visits/:id/reschedule", () => {
  it("RN-195, RN-196, CU-51: cancels the original by the adopter and requests a pending visit for the same pet in the new slot", async () => {
    for (const status of ["PENDING", "CONFIRMED"] as const) {
      await truncateAll();
      shelter = await createShelter();
      adopter = await createAdopter();
      cookie = await sessionCookie(adopter.id);
      petId = (await createPet({ shelterId: shelter.id, name: "Luna" })).id;
      const id = await original(status);
      const newSlot = await slot({ startsAt: new Date(Date.now() + 10 * DAY) });

      const res = await reschedule(id, { slotId: newSlot });

      expect(res.status, status).toBe(201);
      expect(res.body.visit).toMatchObject({ status: "PENDING", petId, petName: "Luna", slotId: newSlot });
      const rows = await visits();
      expect(rows).toEqual([
        expect.objectContaining({ id, status: "CANCELLED", cancelled_by: "ADOPTER" }),
        { id: res.body.visit.id, status: "PENDING", cancelled_by: null, slot_id: newSlot, pet_id: petId, replaces_visit_id: id },
      ]);
    }
  });

  it("CU-51: the shelter is notified about the new request and both changes are audited (RN-208)", async () => {
    const id = await original();
    const newSlot = await slot({ startsAt: new Date(Date.now() + 10 * DAY) });

    const res = await reschedule(id, { slotId: newSlot });

    expect(res.status).toBe(201);
    const newId = res.body.visit.id as number;
    expect(await notifications()).toEqual([{ user_id: shelter.id, type: "VISIT_RESCHEDULED", body: expect.stringContaining("Luna"), visit_id: newId }]);
    expect(await auditActions()).toEqual([
      { action: "VISIT_CANCELLED", entity_id: id, actor_user_id: adopter.id },
      { action: "VISIT_REQUESTED", entity_id: newId, actor_user_id: adopter.id },
    ]);
  });

  it("RN-195, CU-51: rejects rescheduling with less than 24 hours left before the original visit", async () => {
    const id = await original("CONFIRMED", new Date(Date.now() + 23 * HOUR));
    const newSlot = await slot();

    const res = await reschedule(id, { slotId: newSlot });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Faltan menos de 24 horas para la visita: ya no se puede reprogramar." });
    expect((await visits()).map((row) => row.status)).toEqual(["CONFIRMED"]);
  });

  it("CU-51: rejects rescheduling a closed visit", async () => {
    for (const status of ["REJECTED", "CANCELLED", "EXPIRED", "VOIDED", "COMPLETED", "NO_SHOW"]) {
      const id = await original("PENDING");
      const updates: Record<string, string> = {
        REJECTED: "status = 'REJECTED', responded_at = now()",
        CANCELLED: "status = 'CANCELLED', cancelled_by = 'ADOPTER', cancelled_at = now()",
        EXPIRED: "status = 'EXPIRED'",
        VOIDED: "status = 'VOIDED', void_reason = 'SLOT_CANCELLED', voided_at = now()",
        COMPLETED: "status = 'COMPLETED', responded_at = now(), attendance_marked_by = 'SYSTEM', attendance_marked_at = now()",
        NO_SHOW: "status = 'NO_SHOW', responded_at = now(), attendance_marked_by = 'SHELTER', attendance_marked_at = now()",
      };
      await getPool().query(`UPDATE "Visit" SET ${updates[status] ?? ""} WHERE id = $1`, [id]);

      const res = await reschedule(id, { slotId: await slot() });

      expect(res.status, status).toBe(409);
      expect(res.body).toEqual({ error: "La visita ya está cerrada." });
    }
    expect((await visits()).every((row) => row.replaces_visit_id === null)).toBe(true);
  });

  it("RN-196, CU-51: if the new slot starts less than 48 h ahead, the original visit is left as it was", async () => {
    const id = await original();
    const soon = await slot({ startsAt: new Date(Date.now() + 47 * HOUR) });

    const res = await reschedule(id, { slotId: soon });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "La visita se tiene que solicitar con al menos 48 horas de antelación." });
    expect(await visits()).toEqual([expect.objectContaining({ id, status: "CONFIRMED", cancelled_by: null })]);
    expect(await notifications()).toEqual([]);
    expect(await auditActions()).toEqual([]);
  });

  it("RN-196, CU-51: if the new slot has no free places, the original visit is left as it was", async () => {
    const id = await original();
    const full = await slot({ capacity: 1 });
    const otherPet = await createPet({ shelterId: shelter.id });
    await createVisit({ adopterId: (await createAdopter()).id, shelterId: shelter.id, petId: otherPet.id, slotId: full });

    const res = await reschedule(id, { slotId: full });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Este turno ya no tiene plazas libres." });
    expect((await visits())[0]).toMatchObject({ id, status: "CONFIRMED" });
  });

  it("RN-196, CU-51: if the pet already has a visit in the new slot, the original visit is left as it was", async () => {
    const id = await original();
    const taken = await slot({ capacity: 3 });
    await createVisit({ adopterId: (await createAdopter()).id, shelterId: shelter.id, petId, slotId: taken });

    const res = await reschedule(id, { slotId: taken });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Esta mascota ya tiene una visita en este turno. Elige otro." });
    expect((await visits())[0]).toMatchObject({ id, status: "CONFIRMED" });
  });

  it("RN-196, RN-90, CU-51: if the quota is used up, the original visit is left as it was", async () => {
    for (let i = 0; i < 3; i++) {
      const other = await createPet({ shelterId: shelter.id });
      await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: other.id, slotId: await slot(), status: "CONFIRMED" });
    }
    const id = await original("PENDING");

    const res = await reschedule(id, { slotId: await slot({ startsAt: new Date(Date.now() + 9 * DAY) }) });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/^Ya tienes 3 visitas confirmadas o realizadas/);
    expect((await visits())[3]).toMatchObject({ id, status: "PENDING" });
  });

  it("RN-196: the cancelled original no longer counts for the quota, so a confirmed visit can be rescheduled with the quota full", async () => {
    for (let i = 0; i < 2; i++) {
      const other = await createPet({ shelterId: shelter.id });
      await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: other.id, slotId: await slot(), status: "CONFIRMED" });
    }
    const id = await original("CONFIRMED");

    const res = await reschedule(id, { slotId: await slot({ startsAt: new Date(Date.now() + 9 * DAY) }) });

    expect(res.status).toBe(201);
  });

  it("RN-195: the new slot must be another one of the same shelter", async () => {
    const id = await original();
    const other = await createShelter();
    const sameSlot = (await visits())[0]?.slot_id ?? 0;

    const resOther = await reschedule(id, { slotId: await slot({ shelterId: other.id }) });
    expect(resOther.status).toBe(404);
    expect(resOther.body).toEqual({ error: "El turno no existe." });

    const resSame = await reschedule(id, { slotId: sameSlot });
    expect(resSame.status).toBe(409);
    expect(resSame.body).toEqual({ error: "Elige un turno distinto al de la visita actual." });
    expect(await visits()).toEqual([expect.objectContaining({ id, status: "CONFIRMED" })]);
  });

  it("CU-51: an adopter cannot reschedule another adopter's visit", async () => {
    const id = await original();
    const other = await createAdopter();

    const res = await reschedule(id, { slotId: await slot() }, await sessionCookie(other.id));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "La visita no existe." });
  });

  it("CU-51: only adopters can reschedule, and the input format is checked", async () => {
    const id = await original();
    expect((await reschedule(id, { slotId: await slot() }, await sessionCookie(shelter.id))).status).toBe(403);
    expect((await request(createApp()).post(`/api/adopter/visits/${String(id)}/reschedule`).send({ slotId: 1 })).status).toBe(401);
    expect((await reschedule("abc", { slotId: 1 })).status).toBe(400);
    expect((await reschedule(id, {})).status).toBe(400);
    expect((await reschedule(id, { slotId: "x" })).status).toBe(400);
  });
});
