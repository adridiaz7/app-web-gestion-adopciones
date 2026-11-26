import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getConfig } from "../../src/server/config.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const DAY = 24 * 60 * 60 * 1000;

let shelter: CreatedUser;
let adopter: CreatedUser;
let cookie: string;

const confirm = (id: number) => request(createApp()).post(`/api/shelter/visits/${String(id)}/confirm`).set("Cookie", cookie).send({});

/** A visit of the adopter for a new pet of `shelterId`, in a slot starting `days` from now (negative: in the past). */
async function visitAt(days: number, status: "PENDING" | "CONFIRMED" | "COMPLETED", shelterId = shelter.id): Promise<number> {
  const pet = await createPet({ shelterId });
  const slot = await createVisitSlot({ shelterId, startsAt: new Date(Date.now() + days * DAY) });
  const { id } = await createVisit({ adopterId: adopter.id, shelterId, petId: pet.id, slotId: slot.id, status: status === "PENDING" ? "PENDING" : "CONFIRMED" });
  if (status === "COMPLETED") {
    await getPool().query(`UPDATE "Visit" SET status = 'COMPLETED', attendance_marked_by = 'SYSTEM', attendance_marked_at = now() WHERE id = $1`, [id]);
  }
  return id;
}

async function visitStatus(id: number): Promise<string> {
  const { rows } = await getPool().query<{ status: string }>(`SELECT status FROM "Visit" WHERE id = $1`, [id]);
  return rows[0]?.status ?? "";
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter();
  adopter = await createAdopter();
  cookie = await sessionCookie(shelter.id);
});

describe("T-48 CU-24 quota when confirming a visit", () => {
  it("RN-90, RN-93: rejects confirming a visit when the adopter already has the quota full at the shelter; the visit stays pending", async () => {
    const { visitQuotaPerShelter, visitQuotaWindowMonths } = getConfig().rules;
    for (let i = 0; i < visitQuotaPerShelter; i++) await visitAt(i % 2 === 0 ? -10 - i : 5 + i, i % 2 === 0 ? "COMPLETED" : "CONFIRMED");
    const pending = await visitAt(7, "PENDING");

    const res = await confirm(pending);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: `El adoptante ya tiene ${String(visitQuotaPerShelter)} visitas confirmadas o realizadas en tu protectora en los últimos ${String(visitQuotaWindowMonths)} meses. La visita sigue pendiente.`,
    });
    expect(await visitStatus(pending)).toBe("PENDING");
    const { rows: notifications } = await getPool().query(`SELECT id FROM "Notification"`);
    expect(notifications).toEqual([]);
    const { rows: audits } = await getPool().query(`SELECT id FROM "Audit_log" WHERE action = 'VISIT_CONFIRMED'`);
    expect(audits).toEqual([]);
  });

  it("RN-91, RN-92: visits outside the window, at other shelters or not confirmed do not count when confirming", async () => {
    const { visitQuotaPerShelter, visitQuotaWindowMonths } = getConfig().rules;
    const other = await createShelter();
    for (let i = 0; i < visitQuotaPerShelter - 1; i++) await visitAt(5 + i, "CONFIRMED");
    await visitAt(-(visitQuotaWindowMonths * 31 + 5), "COMPLETED");
    await visitAt(6, "CONFIRMED", other.id);
    await visitAt(8, "PENDING");
    const pending = await visitAt(9, "PENDING");

    const res = await confirm(pending);

    expect(res.status).toBe(200);
    expect(await visitStatus(pending)).toBe("CONFIRMED");
  });
});
