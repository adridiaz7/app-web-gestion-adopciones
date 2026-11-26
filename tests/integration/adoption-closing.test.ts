import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const DAY = 24 * 60 * 60 * 1000;

let shelter: CreatedUser;
let shelterCookie: string;
let petId: number;

type AdoptionStatus = "PENDING" | "APPROVED" | "NOT_SELECTED" | "COMPLETED";

const post = (path: string, cookie: string, body: object = {}) => request(createApp()).post(path).set("Cookie", cookie).send(body);
const shelterAction = (id: number, action: "deliver" | "return" | "cancel", body: object = {}, cookie = shelterCookie) =>
  post(`/api/shelter/adoptions/${String(id)}/${action}`, cookie, body);
const adopterCancel = (id: number, cookie: string, body: object = { reason: "Ya no puedo adoptar" }) => post(`/api/adopter/adoptions/${String(id)}/cancel`, cookie, body);

/** An adoption of the pet by a new adopter, enabled by a completed visit, with that status (the pet follows it). */
async function adoption(status: AdoptionStatus, pet = petId): Promise<{ id: number; adopterId: number; cookie: string }> {
  const adopter = await createAdopter();
  const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() - 3 * DAY) });
  const visit = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: pet, slotId: slot.id, status: "CONFIRMED" });
  await getPool().query(`UPDATE "Visit" SET status = 'COMPLETED', attendance_marked_by = 'SYSTEM', attendance_marked_at = now() WHERE id = $1`, [visit.id]);
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO "Adoption" (adopter_id, pet_id, visit_id, questionnaire_answers, status, decided_at, delivered_at)
     VALUES ($1, $2, $3, '{}', $4, CASE WHEN $4 <> 'PENDING' THEN now() END, CASE WHEN $4 = 'COMPLETED' THEN now() END) RETURNING id`,
    [adopter.id, pet, visit.id, status],
  );
  if (status === "APPROVED") await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [pet]);
  if (status === "COMPLETED") await getPool().query(`UPDATE "Pet" SET status = 'ADOPTED' WHERE id = $1`, [pet]);
  return { id: rows[0]?.id ?? 0, adopterId: adopter.id, cookie: await sessionCookie(adopter.id) };
}

interface AdoptionRow {
  status: string;
  delivered: boolean;
  returned: boolean;
  return_reason: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
}

async function adoptionRow(id: number): Promise<AdoptionRow> {
  const { rows } = await getPool().query<AdoptionRow>(
    `SELECT status, delivered_at IS NOT NULL AS delivered, returned_at IS NOT NULL AS returned, return_reason, cancelled_by, cancellation_reason
       FROM "Adoption" WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error("adoption not found");
  return row;
}

async function petStatus(id = petId): Promise<string> {
  const { rows } = await getPool().query<{ status: string }>(`SELECT status FROM "Pet" WHERE id = $1`, [id]);
  return rows[0]?.status ?? "";
}

async function notifications(): Promise<{ user_id: number; type: string }[]> {
  const { rows } = await getPool().query<{ user_id: number; type: string }>(`SELECT user_id, type FROM "Notification" ORDER BY id`);
  return rows;
}

async function audits(): Promise<{ action: string; entity_type: string; details: unknown }[]> {
  const { rows } = await getPool().query<{ action: string; entity_type: string; details: unknown }>(`SELECT action, entity_type, details FROM "Audit_log" ORDER BY id`);
  return rows;
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter();
  shelterCookie = await sessionCookie(shelter.id);
  petId = (await createPet({ shelterId: shelter.id, name: "Luna" })).id;
});

describe("T-32 CU-31 POST /api/shelter/adoptions/:id/deliver", () => {
  it("RN-126, CU-31: registering the delivery completes the adoption with its date and the pet becomes adopted", async () => {
    const { id } = await adoption("APPROVED");

    const res = await shelterAction(id, "deliver");

    expect(res.status).toBe(200);
    expect(res.body.adoption).toEqual({ id, status: "COMPLETED" });
    expect(await adoptionRow(id)).toMatchObject({ status: "COMPLETED", delivered: true });
    expect(await petStatus()).toBe("ADOPTED");
    expect(await audits()).toEqual([
      { action: "ADOPTION_COMPLETED", entity_type: "Adoption", details: { before: { status: "APPROVED" }, after: { status: "COMPLETED" } } },
      { action: "PET_STATUS_CHANGED", entity_type: "Pet", details: { before: { status: "RESERVED" }, after: { status: "ADOPTED" } } },
    ]);
  });

  it("CU-31: the adoption is not approved", async () => {
    for (const status of ["PENDING", "COMPLETED"] as const) {
      const { id } = await adoption(status, (await createPet({ shelterId: shelter.id })).id);
      const res = await shelterAction(id, "deliver");
      expect(res.status, status).toBe(409);
      expect(res.body).toEqual({ error: "La adopción no está aprobada." });
      expect((await adoptionRow(id)).status).toBe(status);
    }
  });
});

describe("T-32 CU-32 POST /api/shelter/adoptions/:id/return", () => {
  it("RN-131, CU-32: a completed adoption is returned with its date and reason, and the pet is available again", async () => {
    const { id } = await adoption("COMPLETED");

    const res = await shelterAction(id, "return", { reason: "Alergia en la familia" });

    expect(res.status).toBe(200);
    expect(res.body.adoption).toEqual({ id, status: "RETURNED" });
    expect(await adoptionRow(id)).toMatchObject({ status: "RETURNED", returned: true, return_reason: "Alergia en la familia" });
    expect(await petStatus()).toBe("AVAILABLE");
    expect((await audits()).map((a) => a.action)).toEqual(["ADOPTION_RETURNED", "PET_STATUS_CHANGED"]);
  });

  it("CU-32: the adoption is not completed", async () => {
    const { id } = await adoption("APPROVED");
    const res = await shelterAction(id, "return", { reason: "Motivo" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "La adopción no está completada." });
    expect((await adoptionRow(id)).status).toBe("APPROVED");
  });

  it("RN-131: the reason is required", async () => {
    const { id } = await adoption("COMPLETED");
    for (const body of [{}, { reason: "   " }]) expect((await shelterAction(id, "return", body)).status).toBe(400);
    expect((await adoptionRow(id)).status).toBe("COMPLETED");
  });
});

describe("T-32 CU-30 cancel an adoption", () => {
  it("CU-30: the adopter withdraws a pending request, with the reason; the pet does not change", async () => {
    const { id, cookie } = await adoption("PENDING");

    const res = await adopterCancel(id, cookie);

    expect(res.status).toBe(200);
    expect(res.body.adoption).toEqual({ id, status: "CANCELLED" });
    expect(await adoptionRow(id)).toMatchObject({ status: "CANCELLED", cancelled_by: "ADOPTER", cancellation_reason: "Ya no puedo adoptar" });
    expect(await petStatus()).toBe("AVAILABLE");
  });

  it("RN-129, RN-130, CU-30: the adopter backs out of an approved adoption; the pet is available again and the not selected candidates and the shelter are told", async () => {
    const { id, cookie } = await adoption("APPROVED");
    const notSelected = await adoption("NOT_SELECTED");

    expect((await adopterCancel(id, cookie)).status).toBe(200);

    expect(await adoptionRow(id)).toMatchObject({ status: "CANCELLED", cancelled_by: "ADOPTER" });
    expect(await petStatus()).toBe("AVAILABLE");
    expect(await notifications()).toEqual([
      { user_id: shelter.id, type: "ADOPTION_CANCELLED_BY_ADOPTER" },
      { user_id: notSelected.adopterId, type: "PET_AVAILABLE_AGAIN" },
    ]);
    expect((await audits()).map((a) => a.action)).toEqual(["ADOPTION_CANCELLED", "PET_STATUS_CHANGED"]);
  });

  it("RN-129, RN-130, CU-30: the shelter backs out of an approved adoption; the adopter and the not selected candidates are told", async () => {
    const approved = await adoption("APPROVED");
    const notSelected = await adoption("NOT_SELECTED");

    const res = await shelterAction(approved.id, "cancel", { reason: "No es el hogar adecuado" });

    expect(res.status).toBe(200);
    expect(await adoptionRow(approved.id)).toMatchObject({ status: "CANCELLED", cancelled_by: "SHELTER", cancellation_reason: "No es el hogar adecuado" });
    expect(await petStatus()).toBe("AVAILABLE");
    expect(await notifications()).toEqual([
      { user_id: approved.adopterId, type: "ADOPTION_CANCELLED_BY_SHELTER" },
      { user_id: notSelected.adopterId, type: "PET_AVAILABLE_AGAIN" },
    ]);
  });

  it("CU-30: the shelter cannot cancel a pending request (it rejects it instead)", async () => {
    const { id } = await adoption("PENDING");
    const res = await shelterAction(id, "cancel", { reason: "Motivo" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "La solicitud está pendiente: recházala en lugar de cancelarla." });
    expect((await adoptionRow(id)).status).toBe("PENDING");
  });

  it("CU-30: the adoption is already closed; a completed one needs a return", async () => {
    const completed = await adoption("COMPLETED");
    for (const res of [await adopterCancel(completed.id, completed.cookie), await shelterAction(completed.id, "cancel", { reason: "Motivo" })]) {
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: "La adopción ya está completada: registra una devolución." });
    }
    const other = await adoption("NOT_SELECTED", (await createPet({ shelterId: shelter.id })).id);
    const res = await adopterCancel(other.id, other.cookie);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "La adopción ya está cerrada." });
  });

  it("RN-129: the reason is required", async () => {
    const { id, cookie } = await adoption("APPROVED");
    expect((await adopterCancel(id, cookie, {})).status).toBe(400);
    expect((await shelterAction(id, "cancel", { reason: "" })).status).toBe(400);
    expect((await adoptionRow(id)).status).toBe("APPROVED");
  });
});

describe("T-32 permissions", () => {
  it("CU-30, CU-31, CU-32: each action needs a session, its role and an adoption of its own", async () => {
    const approved = await adoption("APPROVED");
    const otherShelter = await sessionCookie((await createShelter()).id);
    const stranger = await sessionCookie((await createAdopter()).id);
    const app = createApp();

    for (const action of ["deliver", "return", "cancel"] as const) {
      expect((await request(app).post(`/api/shelter/adoptions/${String(approved.id)}/${action}`).send({ reason: "x" })).status, action).toBe(401);
      expect((await shelterAction(approved.id, action, { reason: "x" }, approved.cookie)).status, action).toBe(403);
      expect((await shelterAction(approved.id, action, { reason: "x" }, otherShelter)).status, action).toBe(404);
    }
    expect((await request(app).post(`/api/adopter/adoptions/${String(approved.id)}/cancel`).send({ reason: "x" })).status).toBe(401);
    expect((await adopterCancel(approved.id, shelterCookie)).status).toBe(403);
    expect((await adopterCancel(approved.id, stranger)).status).toBe(404);
    expect((await shelterAction(0, "deliver")).status).toBe(400);
    expect((await adoptionRow(approved.id)).status).toBe("APPROVED");
    expect(await petStatus()).toBe("RESERVED");
  });
});
