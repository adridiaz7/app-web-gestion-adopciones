import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { liftExpiredBlocks } from "../../src/server/services/adopter-blocks.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const DAY = 24 * 60 * 60 * 1000;

let shelter: CreatedUser;
let adopter: CreatedUser;
let cookie: string;

const blockUrl = (adopterId: number) => `/api/shelter/adopters/${String(adopterId)}/block`;
const block = (body: object = { reason: "INAPPROPRIATE_BEHAVIOUR", detail: "Insultos por el chat" }, adopterId = adopter.id, as = cookie) =>
  request(createApp()).post(blockUrl(adopterId)).set("Cookie", as).send(body);
const unblock = (adopterId = adopter.id, as = cookie) => request(createApp()).post(`/api/shelter/adopters/${String(adopterId)}/unblock`).set("Cookie", as);
const getBlock = (adopterId = adopter.id, as = cookie) => request(createApp()).get(blockUrl(adopterId)).set("Cookie", as);

/** A visit of the adopter to a new pet of the shelter, with that status, `days` from now. */
async function visit(status: "PENDING" | "CONFIRMED", shelterId = shelter.id, days = 5, petName = "Luna"): Promise<{ id: number; petId: number }> {
  const pet = await createPet({ shelterId, name: petName });
  const slot = await createVisitSlot({ shelterId, startsAt: new Date(Date.now() + days * DAY) });
  const { id } = await createVisit({ adopterId: adopter.id, shelterId, petId: pet.id, slotId: slot.id, status });
  return { id, petId: pet.id };
}

/** An adoption of a new pet of the shelter by `adopterId`, enabled by a completed visit. */
async function adoption(status: "PENDING" | "APPROVED" | "NOT_SELECTED", adopterId = adopter.id, petId?: number): Promise<{ id: number; petId: number }> {
  const pet = petId ?? (await createPet({ shelterId: shelter.id, name: "Kira" })).id;
  const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() - 3 * DAY) });
  const v = await createVisit({ adopterId, shelterId: shelter.id, petId: pet, slotId: slot.id, status: "CONFIRMED" });
  await getPool().query(`UPDATE "Visit" SET status = 'COMPLETED', attendance_marked_by = 'SYSTEM', attendance_marked_at = now() WHERE id = $1`, [v.id]);
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO "Adoption" (adopter_id, pet_id, visit_id, questionnaire_answers, status, decided_at)
     VALUES ($1, $2, $3, '{}', $4, CASE WHEN $4 <> 'PENDING' THEN now() END) RETURNING id`,
    [adopterId, pet, v.id, status],
  );
  if (status === "APPROVED") await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [pet]);
  return { id: rows[0]?.id ?? 0, petId: pet };
}

interface BlockRow {
  shelter_id: number;
  adopter_id: number;
  reason: string;
  detail: string | null;
  days: number | null;
  lifted: boolean;
  lifted_by: string | null;
}

async function blockRows(): Promise<BlockRow[]> {
  const { rows } = await getPool().query<BlockRow>(
    `SELECT shelter_id, adopter_id, reason, detail, round(extract(epoch FROM ends_at - created_at) / 86400)::int AS days,
            lifted_at IS NOT NULL AS lifted, lifted_by
       FROM "Block" ORDER BY id`,
  );
  return rows;
}

async function notifications(userId: number): Promise<{ type: string; body: string }[]> {
  const { rows } = await getPool().query<{ type: string; body: string }>(`SELECT type, body FROM "Notification" WHERE user_id = $1 ORDER BY id`, [userId]);
  return rows;
}

async function audits(action: string): Promise<{ actor_user_id: number | null; entity_type: string; details: unknown }[]> {
  const { rows } = await getPool().query<{ actor_user_id: number | null; entity_type: string; details: unknown }>(
    `SELECT actor_user_id, entity_type, details FROM "Audit_log" WHERE action = $1 ORDER BY id`,
    [action],
  );
  return rows;
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter({ name: "Refugio Esperanza" });
  adopter = await createAdopter();
  cookie = await sessionCookie(shelter.id);
});

describe("T-34 CU-35 POST /api/shelter/adopters/:id/block", () => {
  it("RN-201, RN-147: the first block lasts 15 days and keeps the internal reason and detail", async () => {
    await visit("PENDING");

    const res = await block();

    expect(res.status).toBe(201);
    expect(res.body.block).toEqual({
      id: expect.any(Number),
      reason: "INAPPROPRIATE_BEHAVIOUR",
      detail: "Insultos por el chat",
      createdAt: expect.any(String),
      endsAt: expect.any(String),
    });
    expect(await blockRows()).toEqual([
      { shelter_id: shelter.id, adopter_id: adopter.id, reason: "INAPPROPRIATE_BEHAVIOUR", detail: "Insultos por el chat", days: 15, lifted: false, lifted_by: null },
    ]);
    expect(await audits("ADOPTER_BLOCKED")).toEqual([
      { actor_user_id: shelter.id, entity_type: "Block", details: { after: { adopterId: adopter.id, reason: "INAPPROPRIATE_BEHAVIOUR", endsAt: expect.any(String) } } },
    ]);
  });

  it("RN-149, RN-147: the adopter is notified with a neutral text that does not show the reason", async () => {
    await visit("PENDING");

    await block();

    const sent = (await notifications(adopter.id)).filter((n) => n.type === "ADOPTER_BLOCKED");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toMatch(/La protectora Refugio Esperanza ha restringido tu acceso a sus mascotas hasta el /);
    expect(sent[0]?.body).not.toContain("Insultos");
    expect(sent[0]?.body).not.toMatch(/bloque/i);
  });

  it("RN-201: any later block of the same shelter is permanent, even if the first one was lifted early", async () => {
    await visit("PENDING");
    expect((await block()).status).toBe(201);
    expect((await unblock()).status).toBe(200);

    const res = await block({ reason: "OTHER" });

    expect(res.status).toBe(201);
    expect(res.body.block.endsAt).toBeNull();
    expect((await blockRows())[1]).toMatchObject({ reason: "OTHER", detail: null, days: null, lifted: false });
    const sent = (await notifications(adopter.id)).filter((n) => n.type === "ADOPTER_BLOCKED");
    expect(sent[1]?.body).not.toContain("hasta el");
  });

  it("RN-201: blocks by other shelters do not count", async () => {
    const other = await createShelter();
    await visit("PENDING");
    await visit("PENDING", other.id);
    expect((await block({ reason: "OTHER" }, adopter.id, await sessionCookie(other.id))).status).toBe(201);

    const res = await block();

    expect(res.status).toBe(201);
    expect(res.body.block.endsAt).not.toBeNull();
  });

  it("RN-148, RN-109, RN-110: the adopter's open visits at the shelter are voided and notified; those at other shelters stay", async () => {
    const other = await createShelter();
    const pending = await visit("PENDING");
    const confirmed = await visit("CONFIRMED", shelter.id, 6, "Toby");
    const elsewhere = await visit("CONFIRMED", other.id);

    expect((await block()).status).toBe(201);

    const { rows } = await getPool().query<{ id: number; status: string; void_reason: string | null }>(`SELECT id, status, void_reason FROM "Visit" ORDER BY id`);
    expect(rows).toEqual([
      { id: pending.id, status: "VOIDED", void_reason: "ADOPTER_BLOCKED" },
      { id: confirmed.id, status: "VOIDED", void_reason: "ADOPTER_BLOCKED" },
      { id: elsewhere.id, status: "CONFIRMED", void_reason: null },
    ]);
    const voided = (await notifications(adopter.id)).filter((n) => n.type === "VISIT_VOIDED_ADOPTER_BLOCKED");
    expect(voided).toHaveLength(2);
    expect(voided[0]?.body).toContain("Luna");
    expect(voided.every((n) => !/bloque/i.test(n.body))).toBe(true);
    expect(await audits("VISIT_VOIDED")).toHaveLength(2);
  });

  it("RN-148, RN-132: a pending adoption is voided with ADOPTER_BLOCKED and the adopter is notified", async () => {
    await visit("PENDING");
    const pending = await adoption("PENDING");

    expect((await block()).status).toBe(201);

    const { rows } = await getPool().query<{ status: string; void_reason: string | null }>(`SELECT status, void_reason FROM "Adoption" WHERE id = $1`, [pending.id]);
    expect(rows).toEqual([{ status: "VOIDED", void_reason: "ADOPTER_BLOCKED" }]);
    expect((await notifications(adopter.id)).map((n) => n.type)).toContain("ADOPTION_VOIDED_ADOPTER_BLOCKED");
    expect(await audits("ADOPTION_VOIDED")).toHaveLength(1);
  });

  it("RN-148, RN-130: an approved adoption is cancelled by the shelter, the pet is available again and the not-selected adopters are told", async () => {
    const approved = await adoption("APPROVED");
    const loser = await createAdopter();
    await adoption("NOT_SELECTED", loser.id, approved.petId);

    expect((await block()).status).toBe(201);

    const { rows } = await getPool().query<{ status: string; cancelled_by: string | null; pet_status: string }>(
      `SELECT a.status, a.cancelled_by, p.status AS pet_status FROM "Adoption" a JOIN "Pet" p ON p.id = a.pet_id WHERE a.id = $1`,
      [approved.id],
    );
    expect(rows).toEqual([{ status: "CANCELLED", cancelled_by: "SHELTER", pet_status: "AVAILABLE" }]);
    expect((await notifications(adopter.id)).map((n) => n.type)).toContain("ADOPTION_CANCELLED_ADOPTER_BLOCKED");
    expect((await notifications(loser.id)).map((n) => n.type)).toEqual(["PET_AVAILABLE_AGAIN"]);
    expect(await audits("ADOPTION_CANCELLED")).toHaveLength(1);
    expect(await audits("PET_STATUS_CHANGED")).toHaveLength(1);
  });

  it("RN-148: once blocked, the adopter no longer sees the shelter's pets", async () => {
    const { petId } = await visit("PENDING");
    const adopterCookie = await sessionCookie(adopter.id);
    expect((await request(createApp()).get(`/api/pets/${String(petId)}`).set("Cookie", adopterCookie)).status).toBe(200);

    await block();

    expect((await request(createApp()).get(`/api/pets/${String(petId)}`).set("Cookie", adopterCookie)).status).toBe(404);
  });

  it("CU-35: rejects blocking an adopter who is already blocked", async () => {
    await visit("PENDING");
    await block();

    const res = await block();

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Este adoptante ya está bloqueado.");
    expect(await blockRows()).toHaveLength(1);
  });

  it("RN-146, CU-35: rejects blocking an adopter who has sent no request to this shelter", async () => {
    const other = await createShelter();
    await visit("PENDING", other.id);

    const res = await block();

    expect(res.status).toBe(404);
    expect(await blockRows()).toEqual([]);
  });

  it("RN-147, CU-35: the reason is required and must be one of the list", async () => {
    await visit("PENDING");

    for (const body of [{}, { reason: "" }, { reason: "ANGRY" }, { detail: "Sin motivo" }]) {
      const res = await block(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await blockRows()).toEqual([]);
  });
});

describe("T-34 CU-35 POST /api/shelter/adopters/:id/unblock", () => {
  it("RN-150: lifts the block early, keeps it in the history and tells the adopter", async () => {
    await visit("PENDING");
    await block();

    const res = await unblock();

    expect(res.status).toBe(200);
    expect(res.body.block).toBeNull();
    expect(await blockRows()).toEqual([expect.objectContaining({ lifted: true, lifted_by: "SHELTER" })]);
    expect((await notifications(adopter.id)).map((n) => n.type)).toContain("BLOCK_LIFTED");
    expect(await audits("ADOPTER_UNBLOCKED")).toEqual([{ actor_user_id: shelter.id, entity_type: "Block", details: { before: { liftedAt: null }, after: { liftedBy: "SHELTER" } } }]);
  });

  it("RN-150: a permanent block can be lifted too", async () => {
    await visit("PENDING");
    await block();
    await unblock();
    await block();

    expect((await unblock()).status).toBe(200);
    expect((await blockRows()).every((row) => row.lifted)).toBe(true);
  });

  it("RN-202: the visits voided by the block are not recovered when it is lifted", async () => {
    const pending = await visit("PENDING");
    await block();

    await unblock();

    const { rows } = await getPool().query<{ status: string }>(`SELECT status FROM "Visit" WHERE id = $1`, [pending.id]);
    expect(rows).toEqual([{ status: "VOIDED" }]);
  });

  it("CU-35: rejects unblocking when there is no active block", async () => {
    await visit("PENDING");

    const res = await unblock();

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Este adoptante no está bloqueado.");
  });
});

describe("T-34 CU-35 GET /api/shelter/adopters/:id/block", () => {
  it("CU-35: returns the active block, or null", async () => {
    await visit("PENDING");
    expect((await getBlock()).body).toEqual({ block: null });

    await block();

    const res = await getBlock();
    expect(res.status).toBe(200);
    expect(res.body.block).toMatchObject({ reason: "INAPPROPRIATE_BEHAVIOUR", detail: "Insultos por el chat", endsAt: expect.any(String) });
  });

  it("RN-29: 404 for an adopter who has sent no request to this shelter", async () => {
    expect((await getBlock()).status).toBe(404);
  });
});

describe("T-34 CU-56 lift expired temporary blocks (scheduled job)", () => {
  it("RN-202, CU-56: lifts the temporary blocks that reached their end, by the system, and tells the adopter", async () => {
    await visit("PENDING");
    await block();
    await getPool().query(`UPDATE "Block" SET created_at = now() - interval '16 days', ends_at = now() - interval '1 minute'`);

    expect(await liftExpiredBlocks()).toBe(1);
    expect(await liftExpiredBlocks()).toBe(0);

    expect(await blockRows()).toEqual([expect.objectContaining({ lifted: true, lifted_by: "SYSTEM" })]);
    expect((await notifications(adopter.id)).map((n) => n.type)).toContain("BLOCK_LIFTED");
    expect(await audits("ADOPTER_UNBLOCKED")).toEqual([{ actor_user_id: null, entity_type: "Block", details: { before: { liftedAt: null }, after: { liftedBy: "SYSTEM" } } }]);
  });

  it("CU-56: a temporary block not yet due, a permanent one or one already lifted are left alone", async () => {
    const second = await createAdopter();
    await visit("PENDING");
    await block();
    await getPool().query(
      `INSERT INTO "Block" (shelter_id, adopter_id, reason, created_at, ends_at) VALUES ($1, $2, 'OTHER', now() - interval '30 days', NULL)`,
      [shelter.id, second.id],
    );
    await getPool().query(
      `INSERT INTO "Block" (shelter_id, adopter_id, reason, created_at, ends_at, lifted_at, lifted_by)
       VALUES ($1, $2, 'OTHER', now() - interval '40 days', now() - interval '25 days', now() - interval '35 days', 'SHELTER')`,
      [shelter.id, second.id],
    );

    expect(await liftExpiredBlocks()).toBe(0);
  });
});

describe("T-34 CU-35 block permissions", () => {
  it("CU-35: a session is required and only shelters block or unblock", async () => {
    await visit("PENDING");
    const adopterCookie = await sessionCookie(adopter.id);
    const adminCookie = await sessionCookie((await createAdmin()).id);
    const body = { reason: "OTHER" };

    expect((await request(createApp()).post(blockUrl(adopter.id)).send(body)).status).toBe(401);
    expect((await request(createApp()).post(`/api/shelter/adopters/${String(adopter.id)}/unblock`)).status).toBe(401);
    expect((await request(createApp()).get(blockUrl(adopter.id))).status).toBe(401);
    for (const other of [adopterCookie, adminCookie]) {
      expect((await block(body, adopter.id, other)).status).toBe(403);
      expect((await unblock(adopter.id, other)).status).toBe(403);
      expect((await getBlock(adopter.id, other)).status).toBe(403);
    }
    expect(await blockRows()).toEqual([]);
  });
});
