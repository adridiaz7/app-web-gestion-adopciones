import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const DATE = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long", year: "numeric" });

let shelter: CreatedUser;
let adopter: CreatedUser;
let cookie: string;
let petId: number;

const requestVisit = (body: object, as = cookie) => request(createApp()).post("/api/adopter/visits").set("Cookie", as).send(body);
const availableSlots = (id: number, as = cookie) => request(createApp()).get(`/api/adopter/pets/${String(id)}/slots`).set("Cookie", as);

/** A slot of the shelter some days ahead. */
const slot = async (options: { startsAt?: Date; capacity?: number; shelterId?: number } = {}) =>
  (await createVisitSlot({ shelterId: options.shelterId ?? shelter.id, startsAt: options.startsAt ?? new Date(Date.now() + 7 * DAY), capacity: options.capacity ?? 2 })).id;

/** A visit of the adopter at the shelter, in a slot starting at `startsAt`, with that status. */
async function pastVisit(status: "CONFIRMED" | "COMPLETED" | "NO_SHOW" | "PENDING" | "CANCELLED", startsAt: Date, shelterId = shelter.id): Promise<void> {
  const pet = await createPet({ shelterId });
  const slotId = await slot({ startsAt, shelterId });
  const visit = await createVisit({ adopterId: adopter.id, shelterId, petId: pet.id, slotId, status: status === "CONFIRMED" ? "CONFIRMED" : "PENDING" });
  if (status === "COMPLETED" || status === "NO_SHOW") {
    await getPool().query(
      `UPDATE "Visit" SET status = $2, responded_at = now(), attendance_marked_by = 'SYSTEM', attendance_marked_at = now() WHERE id = $1`,
      [visit.id, status],
    );
  } else if (status === "CANCELLED") {
    await getPool().query(`UPDATE "Visit" SET status = 'CANCELLED', cancelled_by = 'ADOPTER', cancelled_at = now() WHERE id = $1`, [visit.id]);
  }
}

async function visitRows(): Promise<{ adopter_id: number; pet_id: number; slot_id: number; status: string }[]> {
  const { rows } = await getPool().query<{ adopter_id: number; pet_id: number; slot_id: number; status: string }>(
    `SELECT adopter_id, pet_id, slot_id, status FROM "Visit" ORDER BY id`,
  );
  return rows;
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter({ name: "Huellas" });
  adopter = await createAdopter();
  cookie = await sessionCookie(adopter.id);
  petId = (await createPet({ shelterId: shelter.id, name: "Luna" })).id;
});

describe("T-22 CU-23 POST /api/adopter/visits", () => {
  it("CU-23, RN-80: requests a visit to a pet in a slot, pending the shelter's confirmation", async () => {
    const startsAt = new Date(Date.now() + 7 * DAY);
    const slotId = await slot({ startsAt });

    const res = await requestVisit({ petId, slotId });

    expect(res.status).toBe(201);
    expect(res.body.visit).toEqual({
      id: expect.any(Number),
      status: "PENDING",
      petId,
      petName: "Luna",
      slotId,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + HOUR).toISOString(),
      shelterName: "Huellas",
      shelterAddress: expect.stringContaining("Calle Falsa 1"),
    });
    expect(await visitRows()).toEqual([{ adopter_id: adopter.id, pet_id: petId, slot_id: slotId, status: "PENDING" }]);
  });

  it("RN-208: records the request in the audit log", async () => {
    const res = await requestVisit({ petId, slotId: await slot() });

    const { rows } = await getPool().query(`SELECT actor_user_id, action, entity_type, entity_id, details FROM "Audit_log"`);
    expect(rows).toEqual([
      { actor_user_id: adopter.id, action: "VISIT_REQUESTED", entity_type: "Visit", entity_id: res.body.visit.id, details: { after: { status: "PENDING" } } },
    ]);
  });

  it("RN-134, RN-133: the first request to a shelter opens the conversation, and there is only one per pair", async () => {
    const otherPet = await createPet({ shelterId: shelter.id });
    const slotId = await slot();

    expect((await requestVisit({ petId, slotId })).status).toBe(201);
    expect((await requestVisit({ petId: otherPet.id, slotId })).status).toBe(201);

    const { rows } = await getPool().query(`SELECT adopter_id, shelter_id FROM "Conversation"`);
    expect(rows).toEqual([{ adopter_id: adopter.id, shelter_id: shelter.id }]);
  });

  it("RN-86, CU-23: the pet is not available", async () => {
    const slotId = await slot();
    await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [petId]);

    const res = await requestVisit({ petId, slotId });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Esta mascota no está disponible." });
    expect(await visitRows()).toEqual([]);
  });

  it("CU-23: answers 404 for a pet that does not exist or whose shelter is not visible", async () => {
    const pending = await createShelter({ validationStatus: "PENDING" });
    const hidden = await createPet({ shelterId: pending.id });
    const hiddenSlot = await slot({ shelterId: pending.id });

    for (const body of [{ petId: 999999, slotId: await slot() }, { petId: hidden.id, slotId: hiddenSlot }]) {
      const res = await requestVisit(body);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Esta mascota no está disponible." });
    }
    expect(await visitRows()).toEqual([]);
  });

  it("RN-88, CU-23: the shelter has blocked the adopter", async () => {
    const slotId = await slot();
    await getPool().query(`INSERT INTO "Block" (shelter_id, adopter_id, reason) VALUES ($1, $2, 'OTHER')`, [shelter.id, adopter.id]);

    const res = await requestVisit({ petId, slotId });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "La protectora Huellas ha restringido tu acceso a sus mascotas." });
    expect(await visitRows()).toEqual([]);
  });

  it("RN-88: a lifted block does not prevent the request", async () => {
    await getPool().query(
      `INSERT INTO "Block" (shelter_id, adopter_id, reason, lifted_at, lifted_by) VALUES ($1, $2, 'OTHER', now(), 'SHELTER')`,
      [shelter.id, adopter.id],
    );

    expect((await requestVisit({ petId, slotId: await slot() })).status).toBe(201);
  });

  it("RN-89, CU-23: an adopter with a no-show at the shelter cannot request more visits there, but can elsewhere", async () => {
    await pastVisit("NO_SHOW", new Date(Date.now() - 10 * DAY));
    const other = await createShelter();
    const otherPet = await createPet({ shelterId: other.id });

    const res = await requestVisit({ petId, slotId: await slot() });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "No puedes solicitar más visitas en esta protectora porque no acudiste a una visita confirmada." });

    expect((await requestVisit({ petId: otherPet.id, slotId: await slot({ shelterId: other.id }) })).status).toBe(201);
  });

  it("RN-82, CU-23: the slot has no free places (pending and confirmed visits take one)", async () => {
    const slotId = await slot({ capacity: 2 });
    const someone = await createAdopter();
    for (const status of ["PENDING", "CONFIRMED"] as const) {
      const pet = await createPet({ shelterId: shelter.id });
      await createVisit({ adopterId: someone.id, shelterId: shelter.id, petId: pet.id, slotId, status });
    }

    const res = await requestVisit({ petId, slotId });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Este turno ya no tiene plazas libres." });
  });

  it("RN-82: visits that are no longer active do not take a place", async () => {
    const slotId = await slot({ capacity: 1 });
    const pet = await createPet({ shelterId: shelter.id });
    const someone = await createAdopter();
    const visit = await createVisit({ adopterId: someone.id, shelterId: shelter.id, petId: pet.id, slotId });
    await getPool().query(`UPDATE "Visit" SET status = 'REJECTED', responded_at = now() WHERE id = $1`, [visit.id]);

    expect((await requestVisit({ petId, slotId })).status).toBe(201);
  });

  it("RN-81, CU-23: the pet already has an active visit in that slot", async () => {
    const slotId = await slot({ capacity: 3 });
    await createVisit({ adopterId: (await createAdopter()).id, shelterId: shelter.id, petId, slotId });

    const res = await requestVisit({ petId, slotId });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Esta mascota ya tiene una visita en este turno. Elige otro." });
  });

  it("RN-87, CU-23: the slot starts in less than 48 hours", async () => {
    const soon = await slot({ startsAt: new Date(Date.now() + 47 * HOUR) });
    const enough = await slot({ startsAt: new Date(Date.now() + 48 * HOUR + 5 * 60 * 1000) });

    const res = await requestVisit({ petId, slotId: soon });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "La visita se tiene que solicitar con al menos 48 horas de antelación." });

    expect((await requestVisit({ petId, slotId: enough })).status).toBe(201);
  });

  it("RN-83: the slot must be one of the pet's shelter, and not cancelled", async () => {
    const other = await createShelter();
    const cancelled = await slot();
    await getPool().query(`UPDATE "Visit_slot" SET cancelled_at = now() WHERE id = $1`, [cancelled]);

    for (const slotId of [await slot({ shelterId: other.id }), cancelled, 999999]) {
      const res = await requestVisit({ petId, slotId });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "El turno no existe." });
    }
    expect(await visitRows()).toEqual([]);
  });

  it("RN-90, RN-93, CU-23: an adopter with 3 confirmed or completed visits in 3 months cannot request another, and is told when a place frees up", async () => {
    const oldest = new Date(Date.now() - 20 * DAY);
    await pastVisit("COMPLETED", oldest);
    await pastVisit("COMPLETED", new Date(Date.now() - 5 * DAY));
    await pastVisit("CONFIRMED", new Date(Date.now() + 3 * DAY));
    const { rows } = await getPool().query<{ at: Date }>(`SELECT $1::timestamptz + interval '3 months' AS at`, [oldest]);

    const res = await requestVisit({ petId, slotId: await slot() });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: `Ya tienes 3 visitas confirmadas o realizadas en esta protectora en los últimos 3 meses. Podrás solicitar otra a partir del ${DATE.format(rows[0]?.at)}.`,
    });
  });

  it("RN-91, RN-92: visits older than 3 months, visits that do not count and other shelters' visits leave the quota free", async () => {
    await pastVisit("COMPLETED", new Date(Date.now() - 100 * DAY));
    await pastVisit("COMPLETED", new Date(Date.now() - 5 * DAY));
    await pastVisit("CONFIRMED", new Date(Date.now() + 3 * DAY));
    await pastVisit("PENDING", new Date(Date.now() + 4 * DAY));
    await pastVisit("CANCELLED", new Date(Date.now() + 5 * DAY));
    const other = await createShelter();
    await pastVisit("COMPLETED", new Date(Date.now() - 6 * DAY), other.id);

    expect((await requestVisit({ petId, slotId: await slot() })).status).toBe(201);
  });

  it("CU-23: rejects a malformed request", async () => {
    for (const body of [{}, { petId: "uno", slotId: 1 }, { petId: 1.5, slotId: 1 }, { petId: 1, slotId: -1 }]) {
      expect((await requestVisit(body)).status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe("T-22 RN-194 GET /api/adopter/pets/:id/slots", () => {
  it("RN-194: lists the slots available for the pet: its shelter's, 48 h ahead or more, with free places and no active visit of the pet", async () => {
    const good = new Date(Date.now() + 5 * DAY);
    const goodId = await slot({ startsAt: good, capacity: 3 });
    await slot({ startsAt: new Date(Date.now() + 47 * HOUR) });
    await slot({ startsAt: new Date(Date.now() - DAY) });
    const full = await slot({ capacity: 1 });
    await createVisit({ adopterId: (await createAdopter()).id, shelterId: shelter.id, petId: (await createPet({ shelterId: shelter.id })).id, slotId: full });
    const withPet = await slot({ capacity: 3 });
    await createVisit({ adopterId: (await createAdopter()).id, shelterId: shelter.id, petId, slotId: withPet });
    const cancelled = await slot();
    await getPool().query(`UPDATE "Visit_slot" SET cancelled_at = now() WHERE id = $1`, [cancelled]);
    await slot({ shelterId: (await createShelter()).id });
    const later = new Date(Date.now() + 9 * DAY);
    const laterId = await slot({ startsAt: later, capacity: 2 });
    await createVisit({ adopterId: (await createAdopter()).id, shelterId: shelter.id, petId: (await createPet({ shelterId: shelter.id })).id, slotId: laterId });

    const res = await availableSlots(petId);

    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([
      { id: goodId, startsAt: good.toISOString(), endsAt: new Date(good.getTime() + HOUR).toISOString(), freePlaces: 3 },
      { id: laterId, startsAt: later.toISOString(), endsAt: new Date(later.getTime() + HOUR).toISOString(), freePlaces: 1 },
    ]);
  });

  it("RN-194: answers 404 for a pet that is not visible to the adopter", async () => {
    await getPool().query(`INSERT INTO "Block" (shelter_id, adopter_id, reason) VALUES ($1, $2, 'OTHER')`, [shelter.id, adopter.id]);

    for (const id of [petId, 999999]) {
      const res = await availableSlots(id);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Esta mascota no está disponible." });
    }
  });
});

describe("T-22 CU-23 permissions", () => {
  it("CU-23: only adopters request visits", async () => {
    const slotId = await slot();
    const others = [await sessionCookie(shelter.id), await sessionCookie((await createAdmin()).id)];
    const app = createApp();
    expect((await request(app).post("/api/adopter/visits").send({ petId, slotId })).status).toBe(401);
    expect((await request(app).get(`/api/adopter/pets/${String(petId)}/slots`)).status).toBe(401);
    for (const other of others) {
      expect((await requestVisit({ petId, slotId }, other)).status).toBe(403);
      expect((await availableSlots(petId, other)).status).toBe(403);
    }
    expect(await visitRows()).toEqual([]);
    const { rows } = await getPool().query(`SELECT id FROM "Conversation"`);
    expect(rows).toEqual([]);
  });
});
