import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const URL = "/api/shelter/slots";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let shelter: CreatedUser;
let cookie: string;

/** A whole hour some days ahead, so the tests do not depend on the current minute. */
function future(days: number, hours = 0): Date {
  const date = new Date(Date.now() + days * DAY + hours * HOUR);
  date.setUTCMinutes(0, 0, 0);
  return date;
}

const create = (body: unknown, as = cookie) => request(createApp()).post(URL).set("Cookie", as).send(body as object);

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter();
  cookie = await sessionCookie(shelter.id);
});

describe("T-20 CU-19 POST /api/shelter/slots", () => {
  it("RN-78: creates a slot with date, start, end and capacity", async () => {
    const startsAt = future(3);
    const endsAt = future(3, 2);
    const res = await create({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), capacity: 3 });
    expect(res.status).toBe(201);
    expect(res.body.slot).toEqual({
      id: expect.any(Number),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      capacity: 3,
      occupied: 0,
      visits: [],
    });
    const { rows } = await getPool().query(`SELECT shelter_id, capacity FROM "Visit_slot"`);
    expect(rows).toEqual([{ shelter_id: shelter.id, capacity: 3 }]);
  });

  it("RN-84, CU-19: the date has already passed", async () => {
    const res = await create({ startsAt: new Date(Date.now() - HOUR).toISOString(), endsAt: new Date(Date.now() + HOUR).toISOString(), capacity: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("El turno no puede empezar en el pasado.");
  });

  it("RN-84, CU-19: the end is not after the start", async () => {
    for (const endsAt of [future(3), future(3, -1)]) {
      const res = await create({ startsAt: future(3).toISOString(), endsAt: endsAt.toISOString(), capacity: 1 });
      expect(res.status).toBe(400);
    }
  });

  it("RN-84, CU-19: the capacity is less than 1", async () => {
    for (const capacity of [0, -1, 1.5, "2"]) {
      const res = await create({ startsAt: future(3).toISOString(), endsAt: future(3, 1).toISOString(), capacity });
      expect(res.status, String(capacity)).toBe(400);
    }
  });

  it("CU-19: rejects malformed dates", async () => {
    const res = await create({ startsAt: "mañana", endsAt: future(3, 1).toISOString(), capacity: 1 });
    expect(res.status).toBe(400);
  });

  it("CU-19: only shelters manage slots", async () => {
    const adopter = await createAdopter();
    const body = { startsAt: future(3).toISOString(), endsAt: future(3, 1).toISOString(), capacity: 1 };
    expect((await create(body, await sessionCookie(adopter.id))).status).toBe(403);
  });
});

describe("T-20 CU-18 GET /api/shelter/slots", () => {
  it("CU-18: lists the shelter's slots in order with occupied places and their visits", async () => {
    const adopter = await createAdopter({ firstName: "Ane", lastName: "Etxeberria" });
    const pet = await createPet({ shelterId: shelter.id, name: "Luna" });
    const other = await createPet({ shelterId: shelter.id, name: "Toby" });
    const later = await createVisitSlot({ shelterId: shelter.id, startsAt: future(5), capacity: 1 });
    const sooner = await createVisitSlot({ shelterId: shelter.id, startsAt: future(2), capacity: 3 });
    const pending = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: pet.id, slotId: sooner.id });
    const confirmed = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: other.id, slotId: sooner.id, status: "CONFIRMED" });
    const rejected = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: pet.id, slotId: later.id });
    await getPool().query(`UPDATE "Visit" SET status = 'REJECTED', responded_at = now() WHERE id = $1`, [rejected.id]);

    const res = await request(createApp()).get(URL).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.slots.map((s: { id: number }) => s.id)).toEqual([sooner.id, later.id]);
    expect(res.body.slots[0]).toEqual(
      expect.objectContaining({
        capacity: 3,
        occupied: 2,
        visits: [
          { id: pending.id, petName: "Luna", adopterName: "Ane Etxeberria", status: "PENDING" },
          { id: confirmed.id, petName: "Toby", adopterName: "Ane Etxeberria", status: "CONFIRMED" },
        ],
      }),
    );
    // RN-82: a rejected visit does not take a place.
    expect(res.body.slots[1]).toEqual(expect.objectContaining({ occupied: 0 }));
  });

  it("CU-18: shows only the shelter's own slots, not cancelled ones", async () => {
    const other = await createShelter();
    await createVisitSlot({ shelterId: other.id });
    const cancelled = await createVisitSlot({ shelterId: shelter.id });
    await getPool().query(`UPDATE "Visit_slot" SET cancelled_at = now() WHERE id = $1`, [cancelled.id]);
    const res = await request(createApp()).get(URL).set("Cookie", cookie);
    expect(res.body.slots).toEqual([]);
  });

  it("CU-18: the shelter has no slots: an empty list", async () => {
    const res = await request(createApp()).get(URL).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ slots: [] });
  });
});

describe("T-20 CU-20 PUT and DELETE /api/shelter/slots/:id", () => {
  let adopter: CreatedUser;
  let petId: number;

  const slotUrl = (id: number) => `${URL}/${String(id)}`;
  const update = (id: number, body: unknown) => request(createApp()).put(slotUrl(id)).set("Cookie", cookie).send(body as object);
  const remove = (id: number) => request(createApp()).delete(slotUrl(id)).set("Cookie", cookie);

  async function visitRows(): Promise<{ status: string; void_reason: string | null }[]> {
    const { rows } = await getPool().query<{ status: string; void_reason: string | null }>(`SELECT status, void_reason FROM "Visit" ORDER BY id`);
    return rows;
  }

  async function notifications(): Promise<{ user_id: number; type: string; visit_id: number }[]> {
    const { rows } = await getPool().query<{ user_id: number; type: string; visit_id: number }>(
      `SELECT user_id, type, visit_id FROM "Notification" ORDER BY id`,
    );
    return rows;
  }

  beforeEach(async () => {
    adopter = await createAdopter();
    petId = (await createPet({ shelterId: shelter.id })).id;
  });

  it("CU-20, RN-112: changing only the capacity keeps the visits", async () => {
    const startsAt = future(3);
    const slot = await createVisitSlot({ shelterId: shelter.id, startsAt, capacity: 2 });
    await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId, slotId: slot.id, status: "CONFIRMED" });
    const res = await update(slot.id, { startsAt: startsAt.toISOString(), endsAt: future(3, 1).toISOString(), capacity: 5 });
    expect(res.status).toBe(200);
    expect(res.body.slot).toEqual(expect.objectContaining({ capacity: 5, occupied: 1 }));
    expect(await visitRows()).toEqual([{ status: "CONFIRMED", void_reason: null }]);
    expect(await notifications()).toEqual([]);
  });

  it("RN-112, CU-20: the new capacity is less than the places already taken", async () => {
    const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: future(3), capacity: 2 });
    const other = (await createPet({ shelterId: shelter.id })).id;
    await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId, slotId: slot.id });
    await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: other, slotId: slot.id, status: "CONFIRMED" });
    const res = await update(slot.id, { startsAt: future(3).toISOString(), endsAt: future(3, 1).toISOString(), capacity: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("El turno ya tiene 2 plazas ocupadas: la capacidad no puede ser menor.");
  });

  it("RN-111, CU-20: changing the date or time voids its active visits and tells the adopters", async () => {
    const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: future(3), capacity: 3 });
    const pending = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId, slotId: slot.id });
    const other = await createAdopter();
    const confirmed = await createVisit({ adopterId: other.id, shelterId: shelter.id, petId: (await createPet({ shelterId: shelter.id })).id, slotId: slot.id, status: "CONFIRMED" });

    const res = await update(slot.id, { startsAt: future(4).toISOString(), endsAt: future(4, 1).toISOString(), capacity: 3 });
    expect(res.status).toBe(200);
    expect(res.body.slot).toEqual(expect.objectContaining({ startsAt: future(4).toISOString(), occupied: 0 }));
    expect(await visitRows()).toEqual([
      { status: "VOIDED", void_reason: "SLOT_CANCELLED" },
      { status: "VOIDED", void_reason: "SLOT_CANCELLED" },
    ]);
    expect(await notifications()).toEqual([
      { user_id: adopter.id, type: "VISIT_VOIDED_SLOT_CANCELLED", visit_id: pending.id },
      { user_id: other.id, type: "VISIT_VOIDED_SLOT_CANCELLED", visit_id: confirmed.id },
    ]);
  });

  it("RN-208: voiding the visits is recorded in the audit log", async () => {
    const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: future(3) });
    const visit = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId, slotId: slot.id });
    await remove(slot.id);
    const { rows } = await getPool().query(`SELECT actor_user_id, action, entity_type, entity_id FROM "Audit_log" WHERE entity_type = 'Visit'`);
    expect(rows).toEqual([{ actor_user_id: shelter.id, action: "VISIT_VOIDED", entity_type: "Visit", entity_id: visit.id }]);
  });

  it("RN-84, CU-20: the new data are not valid", async () => {
    const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: future(3) });
    expect((await update(slot.id, { startsAt: new Date(Date.now() - HOUR).toISOString(), endsAt: future(3).toISOString(), capacity: 1 })).status).toBe(400);
    expect((await update(slot.id, { startsAt: future(3, 2).toISOString(), endsAt: future(3, 1).toISOString(), capacity: 1 })).status).toBe(400);
  });

  it("RN-85, CU-20: deletes a future slot, voiding its visits and telling the adopters", async () => {
    const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: future(3) });
    const visit = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId, slotId: slot.id, status: "CONFIRMED" });
    const res = await remove(slot.id);
    expect(res.status).toBe(204);
    const { rows } = await getPool().query(`SELECT cancelled_at IS NOT NULL AS cancelled FROM "Visit_slot" WHERE id = $1`, [slot.id]);
    expect(rows).toEqual([{ cancelled: true }]);
    expect(await visitRows()).toEqual([{ status: "VOIDED", void_reason: "SLOT_CANCELLED" }]);
    expect(await notifications()).toEqual([{ user_id: adopter.id, type: "VISIT_VOIDED_SLOT_CANCELLED", visit_id: visit.id }]);
  });

  it("RN-85, CU-20: a slot that has already started cannot be deleted or changed (it is history)", async () => {
    const past = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() - DAY) });
    const res = await remove(past.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Este turno ya ha pasado: se conserva como historial de sus visitas.");
    expect((await update(past.id, { startsAt: future(3).toISOString(), endsAt: future(3, 1).toISOString(), capacity: 1 })).status).toBe(409);
  });

  it("CU-20: a slot of another shelter or a cancelled one is not found", async () => {
    const other = await createShelter();
    const foreign = await createVisitSlot({ shelterId: other.id });
    const cancelled = await createVisitSlot({ shelterId: shelter.id });
    await getPool().query(`UPDATE "Visit_slot" SET cancelled_at = now() WHERE id = $1`, [cancelled.id]);
    for (const id of [foreign.id, cancelled.id]) {
      expect((await remove(id)).status).toBe(404);
      expect((await update(id, { startsAt: future(3).toISOString(), endsAt: future(3, 1).toISOString(), capacity: 1 })).status).toBe(404);
    }
  });
});
