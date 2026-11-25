import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createShelter, type CreatedUser } from "../helpers/factories.js";

const URL = "/api/shelter/slots/recurring";
const DAY = 24 * 60 * 60 * 1000;
const madridFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" });

let shelter: CreatedUser;
let cookie: string;

/** Today in Madrid plus `days`, as YYYY-MM-DD. */
function madridDay(days: number): string {
  const [year, month, day] = madridFormat.format(new Date()).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a YYYY-MM-DD date. */
function weekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);
}

/** The slots in the database, in Madrid time. */
async function slotsInMadrid(shelterId = shelter.id): Promise<{ start: string; end: string; capacity: number }[]> {
  const { rows } = await getPool().query<{ start: string; end: string; capacity: number }>(
    `SELECT to_char(starts_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS start,
            to_char(ends_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS end,
            capacity
       FROM "Visit_slot" WHERE shelter_id = $1 AND cancelled_at IS NULL ORDER BY starts_at`,
    [shelterId],
  );
  return rows;
}

/** A slot inserted directly, in Madrid time. */
async function insertSlot(shelterId: number, start: string, end: string, cancelled = false): Promise<void> {
  await getPool().query(
    `INSERT INTO "Visit_slot" (shelter_id, starts_at, ends_at, capacity, cancelled_at)
     VALUES ($1, $2::timestamp AT TIME ZONE 'Europe/Madrid', $3::timestamp AT TIME ZONE 'Europe/Madrid', 2,
             CASE WHEN $4 THEN now() END)`,
    [shelterId, start, end, cancelled],
  );
}

/** A Madrid local time as an ISO instant. */
async function madridInstant(local: string): Promise<string> {
  const { rows } = await getPool().query<{ at: Date }>(`SELECT $1::timestamp AT TIME ZONE 'Europe/Madrid' AS at`, [local]);
  const row = rows[0];
  if (!row) throw new Error("no instant");
  return row.at.toISOString();
}

const create = (body: unknown, as = cookie) => request(createApp()).post(URL).set("Cookie", as).send(body as object);

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const startDate = madridDay(7);
  return { startDate, endDate: addDays(startDate, 13), weekdays: [weekday(startDate)], startTime: "10:00", endTime: "12:00", capacity: 3, ...overrides };
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter();
  cookie = await sessionCookie(shelter.id);
});

describe("T-21 CU-50 POST /api/shelter/slots/recurring", () => {
  it("RN-192, CU-50: creates an independent slot for each chosen weekday in the range, in Madrid time", async () => {
    const startDate = madridDay(7);
    const other = addDays(startDate, 2);

    const res = await create(body({ startDate, endDate: addDays(startDate, 13), weekdays: [weekday(startDate), weekday(other)] }));

    expect(res.status).toBe(201);
    const expected = [startDate, other, addDays(startDate, 7), addDays(other, 7)].map((date) => ({
      start: `${date} 10:00`,
      end: `${date} 12:00`,
      capacity: 3,
    }));
    expect(await slotsInMadrid()).toEqual(expected);
    expect(res.body.slots).toHaveLength(4);
    expect(res.body.slots[0]).toEqual({
      id: expect.any(Number),
      startsAt: expect.any(String),
      endsAt: expect.any(String),
      capacity: 3,
      occupied: 0,
      visits: [],
    });
    expect(res.body.skipped).toEqual([]);
  });

  it("CU-50: rejects a range whose start date has already passed", async () => {
    const res = await create(body({ startDate: madridDay(-1) }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("La fecha de inicio ya ha pasado.");
    expect(await slotsInMadrid()).toEqual([]);
  });

  it("RN-192: does not create the slots of today that have already started", async () => {
    const today = madridDay(0);
    const tomorrow = madridDay(1);

    const res = await create(body({ startDate: today, endDate: tomorrow, weekdays: [1, 2, 3, 4, 5, 6, 7], startTime: "00:00", endTime: "00:30" }));

    expect(res.status).toBe(201);
    expect(await slotsInMadrid()).toEqual([{ start: `${tomorrow} 00:00`, end: `${tomorrow} 00:30`, capacity: 3 }]);
  });

  it("RN-192, CU-50: the range can last at most 3 months", async () => {
    const startDate = `${madridDay(70).slice(0, 8)}01`;
    const [year, month] = startDate.split("-").map(Number) as [number, number];
    const threeMonthsLater = new Date(Date.UTC(year, month - 1 + 3, 1)).toISOString().slice(0, 10);

    const tooLong = await create(body({ startDate, endDate: addDays(threeMonthsLater, 1), weekdays: [1] }));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toBe("El rango de fechas no puede superar los 3 meses.");
    expect(await slotsInMadrid()).toEqual([]);

    const justEnough = await create(body({ startDate, endDate: threeMonthsLater, weekdays: [1] }));
    expect(justEnough.status).toBe(201);
  });

  it("CU-50: rejects an end date before the start date", async () => {
    const startDate = madridDay(7);

    const res = await create(body({ startDate, endDate: addDays(startDate, -1) }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("La fecha de fin no puede ser anterior a la de inicio.");
  });

  it("CU-50: no weekday has been chosen", async () => {
    const res = await create(body({ weekdays: [] }));

    expect(res.status).toBe(400);
    expect(res.body.fields).toMatchObject({ weekdays: "Elige al menos un día de la semana." });
  });

  it("RN-84, CU-50: the end time is not after the start time", async () => {
    for (const endTime of ["10:00", "09:00"]) {
      const res = await create(body({ startTime: "10:00", endTime }));
      expect(res.status, endTime).toBe(400);
      expect(res.body.error).toBe("La hora de fin tiene que ser posterior a la de inicio.");
    }
    expect(await slotsInMadrid()).toEqual([]);
  });

  it("RN-84, CU-50: the capacity is less than 1", async () => {
    for (const capacity of [0, -1, 1.5, "2"]) {
      expect((await create(body({ capacity }))).status, String(capacity)).toBe(400);
    }
  });

  it("CU-50: rejects malformed dates, times and weekdays", async () => {
    for (const overrides of [
      { startDate: "mañana" },
      { endDate: "2026-02-30" },
      { startTime: "25:00" },
      { endTime: "9:00" },
      { weekdays: [0] },
      { weekdays: [8] },
      { weekdays: [1, 1] },
    ]) {
      expect((await create(body(overrides))).status, JSON.stringify(overrides)).toBe(400);
    }
  });

  it("RN-192, CU-50: skips the dates that overlap an existing slot and reports them", async () => {
    const startDate = madridDay(7);
    const nextWeek = addDays(startDate, 7);
    await insertSlot(shelter.id, `${startDate} 11:30`, `${startDate} 13:00`);

    const res = await create(body({ startDate, endDate: nextWeek }));

    expect(res.status).toBe(201);
    expect(await slotsInMadrid()).toEqual([
      { start: `${startDate} 11:30`, end: `${startDate} 13:00`, capacity: 2 },
      { start: `${nextWeek} 10:00`, end: `${nextWeek} 12:00`, capacity: 3 },
    ]);
    expect(res.body.slots).toHaveLength(1);
    expect(res.body.skipped).toEqual([
      { startsAt: await madridInstant(`${startDate} 10:00`), endsAt: await madridInstant(`${startDate} 12:00`) },
    ]);
  });

  it("RN-192: slots that only touch, cancelled slots and other shelters' slots do not block the new ones", async () => {
    const startDate = madridDay(7);
    const other = await createShelter();
    await insertSlot(shelter.id, `${startDate} 08:00`, `${startDate} 10:00`);
    await insertSlot(shelter.id, `${startDate} 12:00`, `${startDate} 13:00`);
    await insertSlot(shelter.id, `${startDate} 10:00`, `${startDate} 12:00`, true);
    await insertSlot(other.id, `${startDate} 10:00`, `${startDate} 12:00`);

    const res = await create(body({ startDate, endDate: startDate }));

    expect(res.status).toBe(201);
    expect(res.body.skipped).toEqual([]);
    expect((await slotsInMadrid()).map((slot) => slot.start)).toEqual([`${startDate} 08:00`, `${startDate} 10:00`, `${startDate} 12:00`]);
  });
});
