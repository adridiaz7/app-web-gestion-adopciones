import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

let shelter: CreatedUser;
let adopter: CreatedUser;
let admin: CreatedUser;
let adminCookie: string;

const changeStatus = (id: number, body: object, as = adminCookie) => request(createApp()).post(`/api/admin/incidents/${String(id)}/status`).set("Cookie", as).send(body);
const correct = (visitId: number, as = adminCookie) => request(createApp()).post(`/api/admin/visits/${String(visitId)}/correct-attendance`).set("Cookie", as);

async function incident(status: "OPEN" | "IN_REVIEW" | "RESOLVED" = "OPEN"): Promise<number> {
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO "Incident" (reporter_id, reported_id, reason, description, status, resolution, resolved_at)
     VALUES ($1, $2, 'WRONG_ATTENDANCE', 'Sí fui a la visita', $3, CASE WHEN $3 = 'RESOLVED' THEN 'Hecho' END, CASE WHEN $3 = 'RESOLVED' THEN now() END)
     RETURNING id`,
    [adopter.id, shelter.id, status],
  );
  return rows[0]?.id ?? 0;
}

async function incidentRow(id: number): Promise<{ status: string; resolution: string | null; resolved: boolean }> {
  const { rows } = await getPool().query<{ status: string; resolution: string | null; resolved: boolean }>(
    `SELECT status, resolution, resolved_at IS NOT NULL AS resolved FROM "Incident" WHERE id = $1`,
    [id],
  );
  return rows[0] ?? { status: "", resolution: null, resolved: false };
}

async function visit(status: "NO_SHOW" | "COMPLETED" | "CONFIRMED"): Promise<number> {
  const pet = await createPet({ shelterId: shelter.id });
  const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) });
  const { id } = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: pet.id, slotId: slot.id, status: "CONFIRMED" });
  if (status !== "CONFIRMED") {
    await getPool().query(`UPDATE "Visit" SET status = $2, attendance_marked_by = 'SHELTER', attendance_marked_at = now() - interval '1 day' WHERE id = $1`, [id, status]);
  }
  return id;
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter();
  adopter = await createAdopter();
  admin = await createAdmin();
  adminCookie = await sessionCookie(admin.id);
});

describe("T-39 CU-37 manage an incident", () => {
  it("CU-37: lists the incidents with a status, for the administrator", async () => {
    const id = await incident();
    await incident("RESOLVED");

    const res = await request(createApp()).get("/api/admin/incidents?status=OPEN").set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.incidents).toEqual([
      expect.objectContaining({ id, reporterId: adopter.id, reportedId: shelter.id, reason: "WRONG_ATTENDANCE", description: "Sí fui a la visita", status: "OPEN" }),
    ]);
  });

  it("RN-168: puts an incident in review, audited", async () => {
    const id = await incident();

    const res = await changeStatus(id, { status: "IN_REVIEW" });

    expect(res.status).toBe(200);
    expect(await incidentRow(id)).toEqual({ status: "IN_REVIEW", resolution: null, resolved: false });
    const { rows } = await getPool().query(`SELECT actor_user_id, entity_type, details FROM "Audit_log" WHERE action = 'INCIDENT_STATUS_CHANGED'`);
    expect(rows).toEqual([{ actor_user_id: admin.id, entity_type: "Incident", details: { before: { status: "OPEN" }, after: { status: "IN_REVIEW" } } }]);
  });

  it("RN-168, RN-169, RN-170: resolves it with its resolution and date; the reporter is told, the other party is not", async () => {
    const id = await incident();

    const res = await changeStatus(id, { status: "RESOLVED", resolution: "Se ha corregido la asistencia." });

    expect(res.status).toBe(200);
    expect(await incidentRow(id)).toEqual({ status: "RESOLVED", resolution: "Se ha corregido la asistencia.", resolved: true });
    const { rows } = await getPool().query<{ user_id: number; type: string; body: string }>(`SELECT user_id, type, body FROM "Notification"`);
    expect(rows).toEqual([{ user_id: adopter.id, type: "INCIDENT_RESOLVED", body: expect.stringContaining("Se ha corregido la asistencia.") }]);
  });

  it("RN-168: resolving or dismissing needs the resolution", async () => {
    const id = await incident();

    for (const status of ["RESOLVED", "DISMISSED"]) {
      expect((await changeStatus(id, { status })).status).toBe(400);
      expect((await changeStatus(id, { status, resolution: "  " })).status).toBe(400);
    }
    expect((await changeStatus(id, { status: "OPEN" })).status).toBe(400);
    expect((await incidentRow(id)).status).toBe("OPEN");
  });

  it("CU-37: rejects changing an incident already resolved or dismissed", async () => {
    const id = await incident("RESOLVED");

    const res = await changeStatus(id, { status: "IN_REVIEW" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("La incidencia ya está cerrada.");
  });

  it("CU-37: 404 for an incident that does not exist", async () => {
    expect((await changeStatus(999999, { status: "IN_REVIEW" })).status).toBe(404);
  });
});

describe("T-39 CU-38 correct an attendance", () => {
  it("RN-108, CU-38: changes a no-show into completed, recording that the administrator did it and when", async () => {
    const id = await visit("NO_SHOW");

    const res = await correct(id);

    expect(res.status).toBe(200);
    const { rows } = await getPool().query<{ status: string; attendance_marked_by: string; recent: boolean }>(
      `SELECT status, attendance_marked_by, attendance_marked_at > now() - interval '1 minute' AS recent FROM "Visit" WHERE id = $1`,
      [id],
    );
    expect(rows).toEqual([{ status: "COMPLETED", attendance_marked_by: "ADMIN", recent: true }]);
    const audits = await getPool().query(`SELECT actor_user_id, entity_type, entity_id, details FROM "Audit_log" WHERE action = 'VISIT_ATTENDANCE_CORRECTED'`);
    expect(audits.rows).toEqual([{ actor_user_id: admin.id, entity_type: "Visit", entity_id: id, details: { before: { status: "NO_SHOW" }, after: { status: "COMPLETED", attendanceMarkedBy: "ADMIN" } } }]);
  });

  it("CU-38: rejects a visit that is not marked as a no-show", async () => {
    for (const status of ["COMPLETED", "CONFIRMED"] as const) {
      const id = await visit(status);
      const res = await correct(id);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("La visita no está marcada como no asistida.");
    }
    expect((await correct(999999)).status).toBe(404);
  });
});

describe("T-39 CU-37, CU-38 permissions", () => {
  it("CU-37, CU-38: only the administrator manages incidents and corrects attendances", async () => {
    const id = await incident();
    const visitId = await visit("NO_SHOW");

    expect((await request(createApp()).get("/api/admin/incidents")).status).toBe(401);
    expect((await request(createApp()).post(`/api/admin/incidents/${String(id)}/status`).send({ status: "IN_REVIEW" })).status).toBe(401);
    expect((await request(createApp()).post(`/api/admin/visits/${String(visitId)}/correct-attendance`)).status).toBe(401);
    for (const user of [adopter, shelter]) {
      const cookie = await sessionCookie(user.id);
      expect((await request(createApp()).get("/api/admin/incidents").set("Cookie", cookie)).status).toBe(403);
      expect((await changeStatus(id, { status: "IN_REVIEW" }, cookie)).status).toBe(403);
      expect((await correct(visitId, cookie)).status).toBe(403);
    }
    expect((await incidentRow(id)).status).toBe("OPEN");
  });
});
