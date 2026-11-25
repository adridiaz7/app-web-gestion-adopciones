import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { createNotification } from "../../src/server/services/notifications.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

let adopter: CreatedUser;
let cookie: string;
let petId: number;

const get = (path: string, as = cookie) => request(createApp()).get(path).set("Cookie", as);
const post = (path: string, as = cookie) => request(createApp()).post(path).set("Cookie", as).send({});

const notify = (userId: number, petName = "Luna", link: { petId: number } | { visitId: number } | undefined = undefined) =>
  createNotification(getPool(), { userId, type: "PET_AVAILABLE_AGAIN", params: { petName }, ...(link ? { link } : {}) });

async function readFlags(): Promise<boolean[]> {
  const { rows } = await getPool().query<{ read: boolean }>(`SELECT read_at IS NOT NULL AS read FROM "Notification" ORDER BY id`);
  return rows.map((row) => row.read);
}

beforeEach(async () => {
  await truncateAll();
  adopter = await createAdopter();
  cookie = await sessionCookie(adopter.id);
  petId = (await createPet({ shelterId: (await createShelter()).id })).id;
});

describe("T-28 CU-34 GET /api/notifications", () => {
  it("CU-34, RN-141: lists the user's own notifications, newest first, with their link (RN-142) and whether they are read", async () => {
    const first = await notify(adopter.id, "Luna", { petId });
    const second = await notify(adopter.id, "Toby");
    await notify((await createAdopter()).id, "Otra");

    const res = await get("/api/notifications");

    expect(res.status).toBe(200);
    expect(res.body.unread).toBe(2);
    expect(res.body.notifications).toEqual([
      { id: second.id, type: "PET_AVAILABLE_AGAIN", title: "Mascota disponible de nuevo", body: "Toby vuelve a estar disponible para adopción.", link: null, read: false, createdAt: expect.any(String) },
      { id: first.id, type: "PET_AVAILABLE_AGAIN", title: "Mascota disponible de nuevo", body: "Luna vuelve a estar disponible para adopción.", link: { petId }, read: false, createdAt: expect.any(String) },
    ]);
  });

  it("CU-34: a visit link is returned as visitId", async () => {
    const shelter = await createShelter();
    const pet = await createPet({ shelterId: shelter.id });
    const slot = await createVisitSlot({ shelterId: shelter.id });
    const visit = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: pet.id, slotId: slot.id });
    await notify(adopter.id, "Luna", { visitId: visit.id });

    const res = await get("/api/notifications");

    expect(res.body.notifications[0].link).toEqual({ visitId: visit.id });
  });

  it("CU-34: with no notifications the list is empty", async () => {
    const res = await get("/api/notifications");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ notifications: [], unread: 0 });
  });

  it("RN-141: shelters and the administrator receive and read notifications too; a session is required", async () => {
    for (const user of [await createShelter(), await createAdmin()]) {
      await notify(user.id);
      const res = await get("/api/notifications", await sessionCookie(user.id));
      expect(res.status).toBe(200);
      expect(res.body.notifications).toHaveLength(1);
    }
    expect((await request(createApp()).get("/api/notifications")).status).toBe(401);
  });
});

describe("T-28 CU-34 GET /api/notifications/unread-count", () => {
  it("CU-34: returns the number of unread notifications for the polling counter", async () => {
    await notify(adopter.id);
    await notify(adopter.id);
    await getPool().query(`UPDATE "Notification" SET read_at = now() WHERE id = (SELECT min(id) FROM "Notification")`);
    await notify((await createAdopter()).id);

    const res = await get("/api/notifications/unread-count");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unread: 1 });
    expect((await request(createApp()).get("/api/notifications/unread-count")).status).toBe(401);
  });
});

describe("T-28 CU-34 marking notifications as read", () => {
  it("CU-34: POST /api/notifications/read marks all the user's notifications as read, and only theirs", async () => {
    await notify(adopter.id);
    await notify(adopter.id);
    await notify((await createAdopter()).id);

    const res = await post("/api/notifications/read");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unread: 0 });
    expect(await readFlags()).toEqual([true, true, false]);
    expect((await get("/api/notifications")).body.notifications.every((n: { read: boolean }) => n.read)).toBe(true);
  });

  it("CU-34: marking again keeps the first read time", async () => {
    await notify(adopter.id);
    await post("/api/notifications/read");
    const { rows: before } = await getPool().query<{ read_at: Date }>(`SELECT read_at FROM "Notification"`);
    expect(before[0]?.read_at).toBeInstanceOf(Date);

    await post("/api/notifications/read");

    const { rows: after } = await getPool().query<{ read_at: Date }>(`SELECT read_at FROM "Notification"`);
    expect(after[0]?.read_at).toEqual(before[0]?.read_at);
  });

  it("CU-34: POST /api/notifications/:id/read marks one notification of the user as read", async () => {
    const mine = await notify(adopter.id);
    await notify(adopter.id);
    const others = await notify((await createAdopter()).id);

    const res = await post(`/api/notifications/${String(mine.id)}/read`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unread: 1 });

    const foreign = await post(`/api/notifications/${String(others.id)}/read`);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ error: "La notificación no existe." });
    expect(await readFlags()).toEqual([true, false, false]);

    expect((await post("/api/notifications/abc/read")).status).toBe(400);
    expect((await request(createApp()).post("/api/notifications/read").send({})).status).toBe(401);
  });
});
