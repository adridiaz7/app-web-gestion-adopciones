import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { completePastVisits, expireUnansweredVisits } from "../../src/server/services/visit-attendance.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const HOUR = 60 * 60 * 1000;

let shelter: CreatedUser;
let adopter: CreatedUser;

/** A visit in a one-hour slot that starts `startsInHours` from now (negative: in the past). */
async function visit(options: { startsInHours: number; status?: "PENDING" | "CONFIRMED"; shelterId?: number; adopterId?: number; petId?: number }) {
  const shelterId = options.shelterId ?? shelter.id;
  const petId = options.petId ?? (await createPet({ shelterId, name: "Luna" })).id;
  const slot = await createVisitSlot({ shelterId, startsAt: new Date(Date.now() + options.startsInHours * HOUR) });
  const { id } = await createVisit({ adopterId: options.adopterId ?? adopter.id, shelterId, petId, slotId: slot.id, status: options.status ?? "CONFIRMED" });
  return { id, petId };
}

async function visitRow(id: number): Promise<{ status: string; attendance_marked_by: string | null; marked: boolean; void_reason: string | null }> {
  const { rows } = await getPool().query<{ status: string; attendance_marked_by: string | null; marked: boolean; void_reason: string | null }>(
    `SELECT status, attendance_marked_by, attendance_marked_at IS NOT NULL AS marked, void_reason FROM "Visit" WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error("visit not found");
  return row;
}

async function notificationTypes(userId: number): Promise<string[]> {
  const { rows } = await getPool().query<{ type: string }>(`SELECT type FROM "Notification" WHERE user_id = $1 ORDER BY id`, [userId]);
  return rows.map((row) => row.type);
}

/** An adoption of `adopterId` for the pet, enabled by a completed visit. */
async function adoption(adopterId: number, petId: number, status: "PENDING" | "APPROVED" | "NOT_SELECTED"): Promise<number> {
  const enabling = await visit({ startsInHours: -100, adopterId, petId });
  await getPool().query(
    `UPDATE "Visit" SET status = 'COMPLETED', attendance_marked_by = 'SYSTEM', attendance_marked_at = now() WHERE id = $1`,
    [enabling.id],
  );
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO "Adoption" (adopter_id, pet_id, visit_id, questionnaire_answers, status, decided_at)
     VALUES ($1, $2, $3, '{}', $4, CASE WHEN $4 <> 'PENDING' THEN now() END) RETURNING id`,
    [adopterId, petId, enabling.id, status],
  );
  return rows[0]?.id ?? 0;
}

const noShow = (id: number, userId = shelter.id) =>
  sessionCookie(userId).then((cookie) => request(createApp()).post(`/api/shelter/visits/${String(id)}/no-show`).set("Cookie", cookie).send({}));

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter();
  adopter = await createAdopter();
});

describe("T-25 CU-45 expire unanswered visit requests", () => {
  it("CU-45, RN-95: expires the requests unanswered for 24 h, frees the place and notifies the adopter", async () => {
    const old = await visit({ startsInHours: 72, status: "PENDING" });
    await getPool().query(`UPDATE "Visit" SET created_at = now() - interval '24 hours 1 minute' WHERE id = $1`, [old.id]);
    const fresh = await visit({ startsInHours: 72, status: "PENDING" });
    const confirmed = await visit({ startsInHours: 72 });
    await getPool().query(`UPDATE "Visit" SET created_at = now() - interval '2 days' WHERE id = $1`, [confirmed.id]);

    expect(await expireUnansweredVisits()).toBe(1);

    expect((await visitRow(old.id)).status).toBe("EXPIRED");
    expect((await visitRow(fresh.id)).status).toBe("PENDING");
    expect((await visitRow(confirmed.id)).status).toBe("CONFIRMED");
    expect(await notificationTypes(adopter.id)).toEqual(["VISIT_EXPIRED"]);
    const { rows } = await getPool().query(`SELECT actor_user_id, action, entity_id FROM "Audit_log"`);
    expect(rows).toEqual([{ actor_user_id: null, action: "VISIT_EXPIRED", entity_id: old.id }]);
  });

  it("CU-45: running it again changes nothing (idempotent)", async () => {
    const old = await visit({ startsInHours: 72, status: "PENDING" });
    await getPool().query(`UPDATE "Visit" SET created_at = now() - interval '25 hours' WHERE id = $1`, [old.id]);

    await expireUnansweredVisits();
    expect(await expireUnansweredVisits()).toBe(0);
    expect(await notificationTypes(adopter.id)).toEqual(["VISIT_EXPIRED"]);
  });
});

describe("T-25 CU-46 mark visits as completed", () => {
  it("CU-46, RN-106, RN-107: marks as completed, by the system, the confirmed visits 48 h after they ended", async () => {
    const due = await visit({ startsInHours: -50 });
    const recent = await visit({ startsInHours: -48 });
    const pending = await visit({ startsInHours: -50, status: "PENDING" });

    expect(await completePastVisits()).toBe(1);
    expect(await completePastVisits()).toBe(0);

    expect(await visitRow(due.id)).toMatchObject({ status: "COMPLETED", attendance_marked_by: "SYSTEM", marked: true });
    expect((await visitRow(recent.id)).status).toBe("CONFIRMED");
    expect((await visitRow(pending.id)).status).toBe("PENDING");
    const { rows } = await getPool().query(`SELECT actor_user_id, action, entity_id FROM "Audit_log"`);
    expect(rows).toEqual([{ actor_user_id: null, action: "VISIT_COMPLETED", entity_id: due.id }]);
  });
});

describe("T-25 CU-26 POST /api/shelter/visits/:id/no-show", () => {
  it("CU-26, RN-102, RN-104, RN-107: the shelter registers that the adopter did not come to a confirmed visit", async () => {
    const { id } = await visit({ startsInHours: -3 });

    const res = await noShow(id);

    expect(res.status).toBe(200);
    expect(res.body.visit).toEqual({ id, status: "NO_SHOW" });
    expect(await visitRow(id)).toMatchObject({ status: "NO_SHOW", attendance_marked_by: "SHELTER", marked: true });
    const { rows } = await getPool().query(`SELECT actor_user_id, action, details FROM "Audit_log" WHERE entity_id = $1`, [id]);
    expect(rows).toEqual([{ actor_user_id: shelter.id, action: "VISIT_NO_SHOW", details: { before: { status: "CONFIRMED" }, after: { status: "NO_SHOW" } } }]);
  });

  it("CU-26, RN-105: the visit has not taken place yet", async () => {
    const { id } = await visit({ startsInHours: -0.5 });

    const res = await noShow(id);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "La visita todavía no ha tenido lugar." });
    expect((await visitRow(id)).status).toBe("CONFIRMED");
  });

  it("CU-26: the visit is not confirmed", async () => {
    const { id } = await visit({ startsInHours: -3, status: "PENDING" });

    const res = await noShow(id);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "La visita no está confirmada." });
  });

  it("CU-26, RN-105: more than 48 hours have passed and the visit is already completed", async () => {
    const notYetMarked = await visit({ startsInHours: -50 });
    const marked = await visit({ startsInHours: -50 });
    await completePastVisits();
    await getPool().query(`UPDATE "Visit" SET status = 'CONFIRMED', attendance_marked_by = NULL, attendance_marked_at = NULL WHERE id = $1`, [notYetMarked.id]);

    for (const id of [notYetMarked.id, marked.id]) {
      const res = await noShow(id);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: "Han pasado más de 48 horas desde la visita: ya cuenta como realizada." });
    }
  });

  it("CU-26: a shelter cannot mark another shelter's visit", async () => {
    const { id } = await visit({ startsInHours: -3 });

    const res = await noShow(id, (await createShelter()).id);

    expect(res.status).toBe(404);
    expect((await visitRow(id)).status).toBe("CONFIRMED");
  });

  it("RN-103, RN-110: voids the adopter's other open visits and pending adoptions at that shelter, with notices, but not elsewhere", async () => {
    const missed = await visit({ startsInHours: -3 });
    const pending = await visit({ startsInHours: 72, status: "PENDING" });
    const confirmed = await visit({ startsInHours: 96 });
    const other = await createShelter();
    const elsewhere = await visit({ startsInHours: 72, shelterId: other.id });
    const pendingAdoption = await adoption(adopter.id, (await createPet({ shelterId: shelter.id })).id, "PENDING");

    expect((await noShow(missed.id)).status).toBe(200);

    expect(await visitRow(pending.id)).toMatchObject({ status: "VOIDED", void_reason: "NO_SHOW" });
    expect(await visitRow(confirmed.id)).toMatchObject({ status: "VOIDED", void_reason: "NO_SHOW" });
    expect((await visitRow(elsewhere.id)).status).toBe("CONFIRMED");
    const { rows } = await getPool().query(`SELECT status, void_reason FROM "Adoption" WHERE id = $1`, [pendingAdoption]);
    expect(rows).toEqual([{ status: "VOIDED", void_reason: "NO_SHOW" }]);
    expect((await notificationTypes(adopter.id)).sort()).toEqual(["ADOPTION_VOIDED_NO_SHOW", "VISIT_VOIDED_NO_SHOW", "VISIT_VOIDED_NO_SHOW"]);
  });

  it("RN-103: an approved adoption at that shelter is cancelled by the system, the pet is available again and the not-selected adopters are told", async () => {
    const missed = await visit({ startsInHours: -3 });
    const pet = await createPet({ shelterId: shelter.id, name: "Kira" });
    await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [pet.id]);
    const approved = await adoption(adopter.id, pet.id, "APPROVED");
    const otherAdopter = await createAdopter();
    await adoption(otherAdopter.id, pet.id, "NOT_SELECTED");

    expect((await noShow(missed.id)).status).toBe(200);

    const { rows } = await getPool().query(`SELECT status, cancelled_by, cancelled_at IS NOT NULL AS cancelled FROM "Adoption" WHERE id = $1`, [approved]);
    expect(rows).toEqual([{ status: "CANCELLED", cancelled_by: "SYSTEM", cancelled: true }]);
    const { rows: pets } = await getPool().query(`SELECT status FROM "Pet" WHERE id = $1`, [pet.id]);
    expect(pets).toEqual([{ status: "AVAILABLE" }]);
    expect(await notificationTypes(adopter.id)).toEqual(["ADOPTION_CANCELLED_NO_SHOW"]);
    const { rows: told } = await getPool().query(`SELECT type, pet_id FROM "Notification" WHERE user_id = $1`, [otherAdopter.id]);
    expect(told).toEqual([{ type: "PET_AVAILABLE_AGAIN", pet_id: pet.id }]);
  });
});

describe("T-25 CU-26 permissions", () => {
  it("CU-26: only shelters register no-shows", async () => {
    const past = await visit({ startsInHours: -2 });
    const upcoming = await visit({ startsInHours: 72, status: "PENDING" });
    expect((await request(createApp()).post(`/api/shelter/visits/${String(past.id)}/no-show`).send({})).status).toBe(401);
    expect((await noShow(past.id, adopter.id)).status).toBe(403);
    expect(await visitRow(past.id)).toEqual({ status: "CONFIRMED", attendance_marked_by: null, marked: false, void_reason: null });
    expect((await visitRow(upcoming.id)).status).toBe("PENDING");
    expect(await notificationTypes(adopter.id)).toEqual([]);
  });
});
