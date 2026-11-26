import { beforeEach, describe, expect, it } from "vitest";
import { getPool } from "../../src/server/db/pool.js";
import { alertOverdueAdoptions, remindPendingAdoptions, remindPendingHandovers } from "../../src/server/services/adoption-reminders.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const DAY = 24 * 60 * 60 * 1000;

let shelter: CreatedUser;

type Status = "PENDING" | "APPROVED" | "COMPLETED" | "REJECTED" | "CANCELLED";

/**
 * An adoption of a new pet "Luna" by a new adopter, requested `ageDays` ago and, unless
 * PENDING, decided `decidedDaysAgo` ago.
 */
async function adoption(status: Status, ageDays: number, decidedDaysAgo = ageDays, shelterId = shelter.id): Promise<number> {
  const adopter = await createAdopter({ firstName: "Ane", lastName: "Etxeberria" });
  const pet = await createPet({ shelterId, name: "Luna" });
  const slot = await createVisitSlot({ shelterId, startsAt: new Date(Date.now() - (ageDays + 2) * DAY) });
  const visit = await createVisit({ adopterId: adopter.id, shelterId, petId: pet.id, slotId: slot.id, status: "CONFIRMED" });
  await getPool().query(`UPDATE "Visit" SET status = 'COMPLETED', attendance_marked_by = 'SYSTEM', attendance_marked_at = now() WHERE id = $1`, [visit.id]);
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO "Adoption" (adopter_id, pet_id, visit_id, questionnaire_answers, status, created_at, decided_at, delivered_at,
                             rejection_reason, cancelled_by, cancellation_reason, cancelled_at)
     VALUES ($1, $2, $3, '{}', $4, now() - make_interval(secs => $5::double precision),
             CASE WHEN $4 <> 'PENDING' THEN now() - make_interval(secs => $6::double precision) END,
             CASE WHEN $4 = 'COMPLETED' THEN now() END,
             CASE WHEN $4 = 'REJECTED' THEN 'No encaja' END,
             CASE WHEN $4 = 'CANCELLED' THEN 'SHELTER' END,
             CASE WHEN $4 = 'CANCELLED' THEN 'Motivo' END,
             CASE WHEN $4 = 'CANCELLED' THEN now() END)
     RETURNING id`,
    [adopter.id, pet.id, visit.id, status, (ageDays * DAY) / 1000, (decidedDaysAgo * DAY) / 1000],
  );
  if (status === "APPROVED") await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [pet.id]);
  if (status === "COMPLETED") await getPool().query(`UPDATE "Pet" SET status = 'ADOPTED' WHERE id = $1`, [pet.id]);
  return rows[0]?.id ?? 0;
}

async function notifications(type: string): Promise<{ user_id: number; body: string; adoption_id: number | null }[]> {
  const { rows } = await getPool().query<{ user_id: number; body: string; adoption_id: number | null }>(
    `SELECT user_id, body, adoption_id FROM "Notification" WHERE type = $1 ORDER BY id`,
    [type],
  );
  return rows;
}

/** Moves the adoption's last reminders back in time, as if they had been sent `daysAgo` ago. */
async function ageReminders(id: number, daysAgo: number): Promise<void> {
  await getPool().query(
    `UPDATE "Adoption"
        SET last_pending_reminder_at = last_pending_reminder_at - make_interval(secs => $2::double precision),
            last_delivery_reminder_at = last_delivery_reminder_at - make_interval(secs => $2::double precision)
      WHERE id = $1`,
    [id, (daysAgo * DAY) / 1000],
  );
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter({ name: "Refugio Esperanza" });
});

describe("T-33 CU-47 reminders of pending adoptions (scheduled job)", () => {
  it("RN-122, CU-47: reminds the shelter of a request unanswered for 3 days, naming the pet and the adopter", async () => {
    const id = await adoption("PENDING", 3.01);

    expect(await remindPendingAdoptions()).toBe(1);

    const sent = await notifications("ADOPTION_PENDING_REMINDER");
    expect(sent).toEqual([{ user_id: shelter.id, body: expect.any(String), adoption_id: id }]);
    expect(sent[0]?.body).toContain("Luna");
    expect(sent[0]?.body).toContain("Ane Etxeberria");
  });

  it("RN-122: a request younger than the configured interval is not reminded yet", async () => {
    await adoption("PENDING", 2.9);

    expect(await remindPendingAdoptions()).toBe(0);
    expect(await notifications("ADOPTION_PENDING_REMINDER")).toEqual([]);
  });

  it("CU-47: no new reminder for that request within 3 days of the last one; the next one comes after them", async () => {
    const id = await adoption("PENDING", 10);
    expect(await remindPendingAdoptions()).toBe(1);

    expect(await remindPendingAdoptions()).toBe(0);
    await ageReminders(id, 2.9);
    expect(await remindPendingAdoptions()).toBe(0);
    await ageReminders(id, 0.2);
    expect(await remindPendingAdoptions()).toBe(1);

    expect(await notifications("ADOPTION_PENDING_REMINDER")).toHaveLength(2);
  });

  it("RN-122: requests already answered (approved, rejected, cancelled…) are not reminded", async () => {
    for (const status of ["APPROVED", "REJECTED", "CANCELLED", "COMPLETED"] as const) await adoption(status, 10, 0);

    expect(await remindPendingAdoptions()).toBe(0);
    expect(await notifications("ADOPTION_PENDING_REMINDER")).toEqual([]);
  });
});

describe("T-33 CU-48 reminders of pending handovers (scheduled job)", () => {
  it("RN-127, CU-48: reminds the shelter daily of an approved adoption without a registered handover", async () => {
    const id = await adoption("APPROVED", 5, 1.01);

    expect(await remindPendingHandovers()).toBe(1);
    expect(await remindPendingHandovers()).toBe(0);

    const sent = await notifications("HANDOVER_REMINDER");
    expect(sent).toEqual([{ user_id: shelter.id, body: expect.any(String), adoption_id: id }]);
    expect(sent[0]?.body).toContain("Luna");

    await ageReminders(id, 0.9);
    expect(await remindPendingHandovers()).toBe(0);
    await ageReminders(id, 0.2);
    expect(await remindPendingHandovers()).toBe(1);
  });

  it("RN-127: an adoption approved less than a day ago is not reminded yet", async () => {
    await adoption("APPROVED", 5, 0.9);

    expect(await remindPendingHandovers()).toBe(0);
  });

  it("CU-48: once the handover is registered or the adoption is cancelled, the reminders stop", async () => {
    await adoption("COMPLETED", 10, 3);
    await adoption("CANCELLED", 10, 3);
    await adoption("PENDING", 10);

    expect(await remindPendingHandovers()).toBe(0);
    expect(await notifications("HANDOVER_REMINDER")).toEqual([]);
  });
});

describe("T-33 CU-48 alert to the administrator (scheduled job)", () => {
  it("RN-128, CU-48: after 5 days without handover the administrator is told once, and nothing changes in the adoption", async () => {
    const admin = await createAdmin();
    const id = await adoption("APPROVED", 10, 5.01);

    expect(await alertOverdueAdoptions()).toBe(1);
    expect(await alertOverdueAdoptions()).toBe(0);

    const sent = await notifications("ADOPTION_OVERDUE");
    expect(sent).toEqual([{ user_id: admin.id, body: expect.any(String), adoption_id: id }]);
    expect(sent[0]?.body).toContain("Luna");
    expect(sent[0]?.body).toContain("Refugio Esperanza");
    const { rows } = await getPool().query<{ status: string; pet_status: string }>(
      `SELECT a.status, p.status AS pet_status FROM "Adoption" a JOIN "Pet" p ON p.id = a.pet_id WHERE a.id = $1`,
      [id],
    );
    expect(rows).toEqual([{ status: "APPROVED", pet_status: "RESERVED" }]);
  });

  it("RN-128: an adoption approved less than 5 days ago, or already delivered, raises no alert", async () => {
    await createAdmin();
    await adoption("APPROVED", 10, 4.9);
    await adoption("COMPLETED", 10, 6);

    expect(await alertOverdueAdoptions()).toBe(0);
    expect(await notifications("ADOPTION_OVERDUE")).toEqual([]);
  });
});
