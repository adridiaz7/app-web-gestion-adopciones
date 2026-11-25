import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { formatDateTime } from "../../src/server/services/notification-templates.js";
import { sendVisitReminders } from "../../src/server/services/visit-reminders.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const HOUR = 60 * 60 * 1000;

let shelter: CreatedUser;
let adopter: CreatedUser;

/** A visit of the adopter to a new pet "Luna", in a slot starting `startsInHours` from now. */
async function visit(startsInHours: number, status: "PENDING" | "CONFIRMED" = "CONFIRMED"): Promise<{ id: number; startsAt: Date }> {
  const pet = await createPet({ shelterId: shelter.id, name: "Luna" });
  const startsAt = new Date(Date.now() + startsInHours * HOUR);
  const slot = await createVisitSlot({ shelterId: shelter.id, startsAt });
  const { id } = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: pet.id, slotId: slot.id, status });
  const { rows } = await getPool().query<{ starts_at: Date }>(`SELECT starts_at FROM "Visit_slot" WHERE id = $1`, [slot.id]);
  return { id, startsAt: rows[0]?.starts_at ?? startsAt };
}

async function reminders(): Promise<{ user_id: number; body: string; visit_id: number | null }[]> {
  const { rows } = await getPool().query<{ user_id: number; body: string; visit_id: number | null }>(
    `SELECT user_id, body, visit_id FROM "Notification" WHERE type = 'VISIT_REMINDER' ORDER BY id`,
  );
  return rows;
}

async function reminderSent(id: number): Promise<boolean> {
  const { rows } = await getPool().query<{ sent: boolean }>(`SELECT reminder_sent_at IS NOT NULL AS sent FROM "Visit" WHERE id = $1`, [id]);
  return rows[0]?.sent ?? false;
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter({ name: "Refugio Esperanza" });
  adopter = await createAdopter();
});

describe("T-26 CU-53 visit reminders (scheduled job)", () => {
  it("RN-197, CU-53: reminds the adopter of a confirmed visit 48 h before, with date, time, address and until when they can cancel", async () => {
    const { id, startsAt } = await visit(47);

    expect(await sendVisitReminders()).toBe(1);

    const sent = await reminders();
    expect(sent).toEqual([{ user_id: adopter.id, body: expect.any(String), visit_id: id }]);
    const body = sent[0]?.body ?? "";
    expect(body).toContain("Luna");
    expect(body).toContain(formatDateTime(startsAt));
    expect(body).toContain("Refugio Esperanza");
    expect(body).toContain("Calle Falsa 1, Donostia");
    expect(body).toContain(`Puedes cancelarla hasta el ${formatDateTime(new Date(startsAt.getTime() - 24 * HOUR))}.`);
    expect(await reminderSent(id)).toBe(true);
  });

  it("RN-197: the reminder is sent only once (the job is idempotent)", async () => {
    await visit(30);

    await sendVisitReminders();
    expect(await sendVisitReminders()).toBe(0);

    expect(await reminders()).toHaveLength(1);
  });

  it("RN-197: no reminder yet for a visit more than 48 h ahead", async () => {
    const { id } = await visit(49);

    expect(await sendVisitReminders()).toBe(0);

    expect(await reminders()).toEqual([]);
    expect(await reminderSent(id)).toBe(false);
  });

  it("RN-97, RN-197: with less than 24 h left the reminder says it can no longer be cancelled", async () => {
    await visit(10);

    await sendVisitReminders();

    const body = (await reminders())[0]?.body ?? "";
    expect(body).toContain("Ya no se puede cancelar.");
    expect(body).not.toContain("Puedes cancelarla");
  });

  it("CU-53: no reminder for a visit that is not confirmed (pending, cancelled, voided or rescheduled) or has already started", async () => {
    await visit(30, "PENDING");
    const cancelled = await visit(30);
    await getPool().query(`UPDATE "Visit" SET status = 'CANCELLED', cancelled_by = 'ADOPTER', cancelled_at = now() WHERE id = $1`, [cancelled.id]);
    const voided = await visit(30);
    await getPool().query(`UPDATE "Visit" SET status = 'VOIDED', void_reason = 'PET_UNLISTED', voided_at = now() WHERE id = $1`, [voided.id]);
    await visit(-1);

    expect(await sendVisitReminders()).toBe(0);

    expect(await reminders()).toEqual([]);
  });

  it("RN-197: confirming a visit with less than 48 h left sends the reminder at once", async () => {
    const { id } = await visit(47, "PENDING");

    const res = await request(createApp()).post(`/api/shelter/visits/${String(id)}/confirm`).set("Cookie", await sessionCookie(shelter.id)).send({});

    expect(res.status).toBe(200);
    expect(await reminders()).toEqual([{ user_id: adopter.id, body: expect.stringContaining("Luna"), visit_id: id }]);
    expect(await reminderSent(id)).toBe(true);
    expect(await sendVisitReminders()).toBe(0);
  });

  it("RN-197: confirming a visit more than 48 h ahead does not send the reminder yet", async () => {
    const { id } = await visit(72, "PENDING");

    const res = await request(createApp()).post(`/api/shelter/visits/${String(id)}/confirm`).set("Cookie", await sessionCookie(shelter.id)).send({});

    expect(res.status).toBe(200);
    expect(await reminders()).toEqual([]);
    expect(await reminderSent(id)).toBe(false);
  });
});
