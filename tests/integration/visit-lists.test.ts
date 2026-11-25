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

const get = async (path: string, userId: number) => request(createApp()).get(path).set("Cookie", await sessionCookie(userId));

/** A visit of `adopterId` for a new pet of `shelterId`, in a slot starting at `startsAt`. */
async function visit(options: { adopterId?: number; shelterId?: number; startsAt: Date; status?: "PENDING" | "CONFIRMED"; petName?: string }): Promise<number> {
  const shelterId = options.shelterId ?? shelter.id;
  const pet = await createPet({ shelterId, name: options.petName ?? "Luna" });
  const slot = await createVisitSlot({ shelterId, startsAt: options.startsAt });
  return (await createVisit({ adopterId: options.adopterId ?? adopter.id, shelterId, petId: pet.id, slotId: slot.id, status: options.status ?? "PENDING" })).id;
}

const setStatus = (id: number, set: string) => getPool().query(`UPDATE "Visit" SET ${set} WHERE id = $1`, [id]);
const completed = (id: number) => setStatus(id, "status = 'COMPLETED', attendance_marked_by = 'SYSTEM', attendance_marked_at = now()");

async function plusMonths(date: Date, months: number): Promise<string> {
  const { rows } = await getPool().query<{ at: Date }>(`SELECT $1::timestamptz + make_interval(months => $2) AS at`, [date, months]);
  return rows[0]?.at.toISOString() ?? "";
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter({ name: "Huellas" });
  adopter = await createAdopter();
});

describe("T-24 CU-21 GET /api/adopter/visits", () => {
  it("CU-21: lists the adopter's visits with pet, shelter, slot and status, soonest first", async () => {
    const later = new Date(Date.now() + 9 * DAY);
    const sooner = new Date(Date.now() + 4 * DAY);
    const laterId = await visit({ startsAt: later, petName: "Kira", status: "CONFIRMED" });
    const soonerId = await visit({ startsAt: sooner, petName: "Luna" });
    await visit({ adopterId: (await createAdopter()).id, startsAt: sooner });

    const res = await get("/api/adopter/visits", adopter.id);

    expect(res.status).toBe(200);
    expect(res.body.visits).toEqual([
      {
        id: soonerId,
        status: "PENDING",
        petId: expect.any(Number),
        petName: "Luna",
        photoUrl: null,
        shelterId: shelter.id,
        shelterName: "Huellas",
        startsAt: sooner.toISOString(),
        endsAt: new Date(sooner.getTime() + HOUR).toISOString(),
        rejectionReason: null,
        cancelledBy: null,
        voidReason: null,
        canCancel: true,
      },
      expect.objectContaining({ id: laterId, status: "CONFIRMED", petName: "Kira", startsAt: later.toISOString() }),
    ]);
  });

  it("RN-96, RN-101, RN-109: closed visits show why they closed", async () => {
    const rejected = await visit({ startsAt: new Date(Date.now() + 3 * DAY) });
    await setStatus(rejected, "status = 'REJECTED', responded_at = now(), rejection_reason = 'Ya tiene muchas visitas.'");
    const cancelled = await visit({ startsAt: new Date(Date.now() + 4 * DAY), status: "CONFIRMED" });
    await setStatus(cancelled, "status = 'CANCELLED', cancelled_by = 'SHELTER', cancelled_at = now()");
    const voided = await visit({ startsAt: new Date(Date.now() + 5 * DAY) });
    await setStatus(voided, "status = 'VOIDED', void_reason = 'SLOT_CANCELLED', voided_at = now()");

    const res = await get("/api/adopter/visits", adopter.id);

    expect(res.body.visits).toEqual([
      expect.objectContaining({ id: rejected, status: "REJECTED", rejectionReason: "Ya tiene muchas visitas." }),
      expect.objectContaining({ id: cancelled, status: "CANCELLED", cancelledBy: "SHELTER" }),
      expect.objectContaining({ id: voided, status: "VOIDED", voidReason: "SLOT_CANCELLED" }),
    ]);
  });

  it("CU-21, RN-90, RN-91: shows for each shelter the visits used of the quota and when the next place frees up", async () => {
    const oldest = new Date(Date.now() - 20 * DAY);
    await completed(await visit({ startsAt: oldest }));
    await visit({ startsAt: new Date(Date.now() + 3 * DAY), status: "CONFIRMED" });
    await visit({ startsAt: new Date(Date.now() + 4 * DAY) });
    await completed(await visit({ startsAt: new Date(Date.now() - 100 * DAY) }));
    const other = await createShelter({ name: "Bigotes" });
    await visit({ shelterId: other.id, startsAt: new Date(Date.now() + 5 * DAY) });

    const res = await get("/api/adopter/visits", adopter.id);

    expect(res.body.quotas).toEqual([
      { shelterId: other.id, shelterName: "Bigotes", used: 0, limit: 3, windowMonths: 3, nextPlaceAt: null, noShow: false },
      { shelterId: shelter.id, shelterName: "Huellas", used: 2, limit: 3, windowMonths: 3, nextPlaceAt: await plusMonths(oldest, 3), noShow: false },
    ]);
  });

  it("CU-21, RN-89: tells the adopter they cannot request visits at a shelter where they did not show up", async () => {
    const id = await visit({ startsAt: new Date(Date.now() - 5 * DAY), status: "CONFIRMED" });
    await setStatus(id, "status = 'NO_SHOW', attendance_marked_by = 'SHELTER', attendance_marked_at = now()");

    const res = await get("/api/adopter/visits", adopter.id);

    expect(res.body.quotas).toEqual([expect.objectContaining({ shelterId: shelter.id, used: 0, noShow: true })]);
  });

  it("RN-97, RN-98: tells which visits can still be cancelled (24 h or more ahead, pending or confirmed)", async () => {
    const soon = await visit({ startsAt: new Date(Date.now() + 23 * HOUR), status: "CONFIRMED" });
    const later = await visit({ startsAt: new Date(Date.now() + 25 * HOUR) });
    const closed = await visit({ startsAt: new Date(Date.now() + 3 * DAY) });
    await setStatus(closed, "status = 'EXPIRED'");

    const res = await get("/api/adopter/visits", adopter.id);

    expect(res.body.visits.map((v: { id: number; canCancel: boolean }) => [v.id, v.canCancel])).toEqual([
      [soon, false],
      [later, true],
      [closed, false],
    ]);
  });

  it("CU-21: the adopter has no visits", async () => {
    const res = await get("/api/adopter/visits", adopter.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ visits: [], quotas: [] });
  });
});

describe("T-24 CU-22 GET /api/shelter/inbox", () => {
  it("CU-22, RN-94: shows the pending requests that can still be answered and the upcoming confirmed visits", async () => {
    const pendingAt = new Date(Date.now() + 6 * DAY);
    const pending = await visit({ startsAt: pendingAt, petName: "Luna" });
    const expired = await visit({ startsAt: new Date(Date.now() + 6 * DAY) });
    await getPool().query(`UPDATE "Visit" SET created_at = now() - interval '25 hours' WHERE id = $1`, [expired]);
    const confirmedLater = await visit({ startsAt: new Date(Date.now() + 8 * DAY), status: "CONFIRMED" });
    const confirmedSooner = await visit({ startsAt: new Date(Date.now() + 2 * DAY), status: "CONFIRMED" });
    await visit({ startsAt: new Date(Date.now() - 2 * DAY), status: "CONFIRMED" });
    const cancelled = await visit({ startsAt: new Date(Date.now() + 3 * DAY) });
    await setStatus(cancelled, "status = 'CANCELLED', cancelled_by = 'ADOPTER', cancelled_at = now()");
    await visit({ shelterId: (await createShelter()).id, startsAt: new Date(Date.now() + 3 * DAY) });

    const res = await get("/api/shelter/inbox", shelter.id);

    expect(res.status).toBe(200);
    const { rows } = await getPool().query<{ respond_by: Date }>(`SELECT created_at + interval '24 hours' AS respond_by FROM "Visit" WHERE id = $1`, [pending]);
    expect(res.body.pending).toEqual([
      {
        id: pending,
        status: "PENDING",
        petId: expect.any(Number),
        petName: "Luna",
        adopterId: adopter.id,
        adopterName: expect.any(String),
        startsAt: pendingAt.toISOString(),
        endsAt: new Date(pendingAt.getTime() + HOUR).toISOString(),
        respondBy: rows[0]?.respond_by.toISOString(),
      },
    ]);
    expect(res.body.upcoming.map((v: { id: number }) => v.id)).toEqual([confirmedSooner, confirmedLater]);
  });

  it("CU-22: there are no pending requests", async () => {
    const res = await get("/api/shelter/inbox", shelter.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: [], upcoming: [] });
  });
});
