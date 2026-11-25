import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type Status = "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED" | "EXPIRED" | "VOIDED" | "COMPLETED" | "NO_SHOW";
const CLOSED: Status[] = ["REJECTED", "CANCELLED", "EXPIRED", "VOIDED", "COMPLETED", "NO_SHOW"];

let shelter: CreatedUser;
let adopter: CreatedUser;
let shelterCookie: string;
let adopterCookie: string;

const post = (path: string, cookie: string, body: object = {}) => request(createApp()).post(path).set("Cookie", cookie).send(body);
const shelterAction = (id: number, action: string, body: object = {}, cookie = shelterCookie) =>
  post(`/api/shelter/visits/${String(id)}/${action}`, cookie, body);
const adopterCancel = (id: number, cookie = adopterCookie) => post(`/api/adopter/visits/${String(id)}/cancel`, cookie);

/** A visit of the adopter for a new pet of the shelter, in a slot starting at `startsAt`, with that status. */
async function visit(status: Status = "PENDING", startsAt = new Date(Date.now() + 7 * DAY)): Promise<number> {
  const pet = await createPet({ shelterId: shelter.id, name: "Luna" });
  const slot = await createVisitSlot({ shelterId: shelter.id, startsAt });
  const { id } = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: pet.id, slotId: slot.id, status: status === "CONFIRMED" ? "CONFIRMED" : "PENDING" });
  const updates: Partial<Record<Status, string>> = {
    REJECTED: "status = 'REJECTED', responded_at = now()",
    CANCELLED: "status = 'CANCELLED', cancelled_by = 'ADOPTER', cancelled_at = now()",
    EXPIRED: "status = 'EXPIRED'",
    VOIDED: "status = 'VOIDED', void_reason = 'SLOT_CANCELLED', voided_at = now()",
    COMPLETED: "status = 'COMPLETED', responded_at = now(), attendance_marked_by = 'SYSTEM', attendance_marked_at = now()",
    NO_SHOW: "status = 'NO_SHOW', responded_at = now(), attendance_marked_by = 'SHELTER', attendance_marked_at = now()",
  };
  const update = updates[status];
  if (update) await getPool().query(`UPDATE "Visit" SET ${update} WHERE id = $1`, [id]);
  return id;
}

interface VisitRow {
  status: string;
  responded: boolean;
  rejection_reason: string | null;
  cancelled_by: string | null;
  cancelled: boolean;
}

async function visitRow(id: number): Promise<VisitRow> {
  const { rows } = await getPool().query<VisitRow>(
    `SELECT status, responded_at IS NOT NULL AS responded, rejection_reason, cancelled_by, cancelled_at IS NOT NULL AS cancelled
       FROM "Visit" WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error("visit not found");
  return row;
}

async function notifications(): Promise<{ user_id: number; type: string; body: string; visit_id: number | null }[]> {
  const { rows } = await getPool().query<{ user_id: number; type: string; body: string; visit_id: number | null }>(
    `SELECT user_id, type, body, visit_id FROM "Notification" ORDER BY id`,
  );
  return rows;
}

async function auditEntries(): Promise<{ actor_user_id: number; action: string; entity_id: number; details: unknown }[]> {
  const { rows } = await getPool().query<{ actor_user_id: number; action: string; entity_id: number; details: unknown }>(
    `SELECT actor_user_id, action, entity_id, details FROM "Audit_log" WHERE entity_type = 'Visit' ORDER BY id`,
  );
  return rows;
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter();
  adopter = await createAdopter();
  shelterCookie = await sessionCookie(shelter.id);
  adopterCookie = await sessionCookie(adopter.id);
});

describe("T-23 CU-24 POST /api/shelter/visits/:id/confirm", () => {
  it("CU-24: the shelter confirms a pending request, the adopter is notified and it is audited (RN-208)", async () => {
    const id = await visit();

    const res = await shelterAction(id, "confirm");

    expect(res.status).toBe(200);
    expect(res.body.visit).toEqual({ id, status: "CONFIRMED" });
    expect(await visitRow(id)).toMatchObject({ status: "CONFIRMED", responded: true });
    expect(await notifications()).toEqual([{ user_id: adopter.id, type: "VISIT_CONFIRMED", body: expect.stringContaining("Luna"), visit_id: id }]);
    expect(await auditEntries()).toEqual([
      { actor_user_id: shelter.id, action: "VISIT_CONFIRMED", entity_id: id, details: { before: { status: "PENDING" }, after: { status: "CONFIRMED" } } },
    ]);
  });

  it("RN-94, CU-24: a request older than 24 hours has expired and can no longer be answered", async () => {
    const id = await visit();
    await getPool().query(`UPDATE "Visit" SET created_at = now() - interval '24 hours 1 minute' WHERE id = $1`, [id]);

    for (const action of ["confirm", "reject"]) {
      const res = await shelterAction(id, action);
      expect(res.status, action).toBe(409);
      expect(res.body).toEqual({ error: "La solicitud ha caducado: han pasado más de 24 horas sin respuesta." });
    }
    expect((await visitRow(id)).status).toBe("PENDING");
    expect(await notifications()).toEqual([]);
  });

  it("CU-24: the adopter has already cancelled the request", async () => {
    const id = await visit("CANCELLED");

    for (const action of ["confirm", "reject"]) {
      const res = await shelterAction(id, action);
      expect(res.status, action).toBe(409);
      expect(res.body).toEqual({ error: "El adoptante ya ha cancelado la solicitud." });
    }
  });

  it("CU-24: only pending requests can be answered", async () => {
    for (const status of ["CONFIRMED", "REJECTED", "EXPIRED", "VOIDED", "COMPLETED", "NO_SHOW"] as const) {
      const id = await visit(status);
      const res = await shelterAction(id, "confirm");
      expect(res.status, status).toBe(409);
      expect(res.body).toEqual({ error: "La visita no está pendiente de respuesta." });
      expect((await visitRow(id)).status).toBe(status);
    }
  });

  it("CU-24: a shelter cannot answer another shelter's visits", async () => {
    const id = await visit();
    const other = await createShelter();

    for (const action of ["confirm", "reject", "cancel"]) {
      const res = await shelterAction(id, action, {}, await sessionCookie(other.id));
      expect(res.status, action).toBe(404);
      expect(res.body).toEqual({ error: "La visita no existe." });
    }
    expect((await visitRow(id)).status).toBe("PENDING");
  });

  it("CU-24: rejects a malformed id", async () => {
    expect((await post("/api/shelter/visits/abc/confirm", shelterCookie)).status).toBe(400);
  });
});

describe("T-23 CU-24 POST /api/shelter/visits/:id/reject", () => {
  it("RN-96, CU-24: rejects a pending request with a reason, which the adopter is told", async () => {
    const id = await visit();

    const res = await shelterAction(id, "reject", { reason: "  Luna ya tiene muchas visitas esa semana.  " });

    expect(res.status).toBe(200);
    expect(res.body.visit).toEqual({ id, status: "REJECTED" });
    expect(await visitRow(id)).toMatchObject({ status: "REJECTED", responded: true, rejection_reason: "Luna ya tiene muchas visitas esa semana." });
    expect(await notifications()).toEqual([
      { user_id: adopter.id, type: "VISIT_REJECTED", body: expect.stringContaining("Motivo: Luna ya tiene muchas visitas esa semana."), visit_id: id },
    ]);
    expect(await auditEntries()).toEqual([
      expect.objectContaining({ action: "VISIT_REJECTED", details: { before: { status: "PENDING" }, after: { status: "REJECTED" } } }),
    ]);
  });

  it("RN-96: the reason is optional", async () => {
    for (const body of [{}, { reason: "   " }]) {
      const id = await visit();
      expect((await shelterAction(id, "reject", body)).status).toBe(200);
      expect(await visitRow(id)).toMatchObject({ status: "REJECTED", rejection_reason: null });
    }
    for (const sent of await notifications()) expect(sent.body).not.toContain("Motivo");
  });

  it("RN-96: the reason cannot be too long", async () => {
    const id = await visit();

    const res = await shelterAction(id, "reject", { reason: "x".repeat(1001) });

    expect(res.status).toBe(400);
    expect((await visitRow(id)).status).toBe("PENDING");
  });
});

describe("T-23 CU-25 POST /api/adopter/visits/:id/cancel", () => {
  it("RN-97, RN-101, CU-25: the adopter cancels a pending or confirmed visit 24 h ahead or more, and the shelter is notified", async () => {
    for (const status of ["PENDING", "CONFIRMED"] as const) {
      const id = await visit(status, new Date(Date.now() + 25 * HOUR));

      const res = await adopterCancel(id);

      expect(res.status, status).toBe(200);
      expect(res.body.visit).toEqual({ id, status: "CANCELLED" });
      expect(await visitRow(id)).toMatchObject({ status: "CANCELLED", cancelled_by: "ADOPTER", cancelled: true });
    }
    const sent = await notifications();
    expect(sent).toHaveLength(2);
    expect(sent.every((n) => n.user_id === shelter.id && n.type === "VISIT_CANCELLED_BY_ADOPTER")).toBe(true);
    expect((await auditEntries()).map((entry) => entry.action)).toEqual(["VISIT_CANCELLED", "VISIT_CANCELLED"]);
  });

  it("RN-98, CU-25: the adopter cannot cancel with less than 24 hours left", async () => {
    const id = await visit("CONFIRMED", new Date(Date.now() + 23 * HOUR));

    const res = await adopterCancel(id);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Faltan menos de 24 horas para la visita: ya no se puede cancelar." });
    expect((await visitRow(id)).status).toBe("CONFIRMED");
  });

  it("CU-25: a closed visit cannot be cancelled", async () => {
    for (const status of CLOSED) {
      const id = await visit(status);
      const res = await adopterCancel(id);
      expect(res.status, status).toBe(409);
      expect(res.body).toEqual({ error: "La visita ya está cerrada." });
    }
  });

  it("CU-25: an adopter cannot cancel someone else's visit", async () => {
    const id = await visit();
    const other = await createAdopter();

    const res = await adopterCancel(id, await sessionCookie(other.id));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "La visita no existe." });
    expect((await visitRow(id)).status).toBe("PENDING");
  });
});

describe("T-23 CU-25 POST /api/shelter/visits/:id/cancel", () => {
  it("RN-100, RN-101, CU-25: the shelter cancels a confirmed visit even with less than 24 h left, and the adopter is notified", async () => {
    const id = await visit("CONFIRMED", new Date(Date.now() + 2 * HOUR));

    const res = await shelterAction(id, "cancel");

    expect(res.status).toBe(200);
    expect(res.body.visit).toEqual({ id, status: "CANCELLED" });
    expect(await visitRow(id)).toMatchObject({ status: "CANCELLED", cancelled_by: "SHELTER", cancelled: true });
    expect(await notifications()).toEqual([{ user_id: adopter.id, type: "VISIT_CANCELLED_BY_SHELTER", body: expect.stringContaining("Luna"), visit_id: id }]);
    expect(await auditEntries()).toEqual([
      expect.objectContaining({ actor_user_id: shelter.id, action: "VISIT_CANCELLED", details: { before: { status: "CONFIRMED" }, after: { status: "CANCELLED", cancelledBy: "SHELTER" } } }),
    ]);
  });

  it("CU-25: the shelter can only cancel a confirmed visit", async () => {
    const pending = await visit("PENDING");
    const res = await shelterAction(pending, "cancel");
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "La visita no está confirmada." });

    for (const status of CLOSED) {
      const id = await visit(status);
      const closed = await shelterAction(id, "cancel");
      expect(closed.status, status).toBe(409);
      expect(closed.body).toEqual({ error: "La visita ya está cerrada." });
    }
  });
});
