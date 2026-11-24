import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import {
  createAdmin,
  createAdopter,
  createPet,
  createShelter,
  createVisit,
  createVisitSlot,
  type CreatedUser,
} from "../helpers/factories.js";

const base = (id: number) => `/api/admin/shelters/${String(id)}`;

let admin: CreatedUser;
let adminCookie: string;

async function shelterState(id: number): Promise<{ validation_status: string; validation_reason: string | null; validated: boolean }> {
  const { rows } = await getPool().query<{ validation_status: string; validation_reason: string | null; validated: boolean }>(
    `SELECT validation_status, validation_reason, validated_at IS NOT NULL AS validated FROM "Shelter" WHERE user_id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error("shelter not found");
  return row;
}

async function auditEntries(): Promise<{ action: string; actor_user_id: number; entity_type: string; entity_id: number; details: unknown }[]> {
  const { rows } = await getPool().query<{ action: string; actor_user_id: number; entity_type: string; entity_id: number; details: unknown }>(
    `SELECT action, actor_user_id, entity_type, entity_id, details FROM "Audit_log" ORDER BY id`,
  );
  return rows;
}

const post = (path: string, cookie: string, body: object = {}) =>
  request(createApp()).post(path).set("Cookie", cookie).send(body);

beforeEach(async () => {
  await truncateAll();
  admin = await createAdmin();
  adminCookie = await sessionCookie(admin.id);
});

describe("T-11 CU-39 GET /api/admin/shelters", () => {
  it("CU-39: lists the shelters with the requested validation status", async () => {
    const pending = await createShelter({ name: "Pendiente", validationStatus: "PENDING", cif: "G11111111" });
    await createShelter({ name: "Validada", validationStatus: "VALIDATED" });

    const res = await request(createApp()).get("/api/admin/shelters?status=PENDING").set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.shelters).toEqual([
      expect.objectContaining({ id: pending.id, name: "Pendiente", cif: "G11111111", email: pending.email, validationStatus: "PENDING" }),
    ]);
  });

  it("CU-39: rejects an unknown status filter", async () => {
    const res = await request(createApp()).get("/api/admin/shelters?status=OTRO").set("Cookie", adminCookie);

    expect(res.status).toBe(400);
  });

  it("CU-39: only the administrator can see the list", async () => {
    const adopter = await createAdopter();
    const shelter = await createShelter();

    expect((await request(createApp()).get("/api/admin/shelters")).status).toBe(401);
    expect((await request(createApp()).get("/api/admin/shelters").set("Cookie", await sessionCookie(adopter.id))).status).toBe(403);
    expect((await request(createApp()).get("/api/admin/shelters").set("Cookie", await sessionCookie(shelter.id))).status).toBe(403);
  });
});

describe("T-11 CU-39 POST /api/admin/shelters/:id/validate", () => {
  it("RN-14, CU-39: validates a pending shelter and records it in the audit log (RN-208)", async () => {
    const shelter = await createShelter({ validationStatus: "PENDING" });

    const res = await post(`${base(shelter.id)}/validate`, adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.shelter).toMatchObject({ id: shelter.id, validationStatus: "VALIDATED", validationReason: null });
    expect(await shelterState(shelter.id)).toEqual({ validation_status: "VALIDATED", validation_reason: null, validated: true });
    expect(await auditEntries()).toEqual([
      {
        action: "SHELTER_VALIDATED",
        actor_user_id: admin.id,
        entity_type: "Shelter",
        entity_id: shelter.id,
        details: { before: { validationStatus: "PENDING" }, after: { validationStatus: "VALIDATED" } },
      },
    ]);
  });

  it("CU-39: rejects validating a shelter that is not pending", async () => {
    const validated = await createShelter({ validationStatus: "VALIDATED" });
    const rejected = await createShelter({ validationStatus: "REJECTED" });

    for (const shelter of [validated, rejected]) {
      const res = await post(`${base(shelter.id)}/validate`, adminCookie);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: "La protectora no está pendiente de validación." });
    }
    expect(await auditEntries()).toEqual([]);
  });

  it("CU-39: answers 404 for a shelter that does not exist or a user that is not a shelter", async () => {
    const adopter = await createAdopter();

    expect((await post(`${base(999999)}/validate`, adminCookie)).status).toBe(404);
    expect((await post(`${base(adopter.id)}/validate`, adminCookie)).status).toBe(404);
  });

  it("CU-39: rejects a malformed id", async () => {
    expect((await post("/api/admin/shelters/abc/validate", adminCookie)).status).toBe(400);
  });

  it("CU-39: only the administrator can validate", async () => {
    const shelter = await createShelter({ validationStatus: "PENDING" });

    const res = await post(`${base(shelter.id)}/validate`, await sessionCookie(shelter.id));

    expect(res.status).toBe(403);
    expect((await shelterState(shelter.id)).validation_status).toBe("PENDING");
  });
});

describe("T-11 CU-39 POST /api/admin/shelters/:id/reject", () => {
  it("RN-18: rejects a pending shelter with a reason, recorded in the audit log", async () => {
    const shelter = await createShelter({ validationStatus: "PENDING" });

    const res = await post(`${base(shelter.id)}/reject`, adminCookie, { reason: "  El CIF no corresponde a ninguna entidad.  " });

    expect(res.status).toBe(200);
    expect(res.body.shelter).toMatchObject({ validationStatus: "REJECTED", validationReason: "El CIF no corresponde a ninguna entidad." });
    expect(await shelterState(shelter.id)).toEqual({
      validation_status: "REJECTED",
      validation_reason: "El CIF no corresponde a ninguna entidad.",
      validated: false,
    });
    expect(await auditEntries()).toEqual([
      expect.objectContaining({
        action: "SHELTER_REJECTED",
        actor_user_id: admin.id,
        entity_id: shelter.id,
        details: {
          before: { validationStatus: "PENDING" },
          after: { validationStatus: "REJECTED", validationReason: "El CIF no corresponde a ninguna entidad." },
        },
      }),
    ]);
  });

  it("RN-18, CU-39: rejecting requires a reason", async () => {
    const shelter = await createShelter({ validationStatus: "PENDING" });

    for (const body of [{}, { reason: "   " }]) {
      const res = await post(`${base(shelter.id)}/reject`, adminCookie, body);
      expect(res.status).toBe(400);
      expect(res.body.fields).toMatchObject({ reason: "Indica el motivo." });
    }
    expect((await shelterState(shelter.id)).validation_status).toBe("PENDING");
  });

  it("CU-39: rejects rejecting a shelter that is not pending", async () => {
    const shelter = await createShelter({ validationStatus: "VALIDATED" });

    const res = await post(`${base(shelter.id)}/reject`, adminCookie, { reason: "Motivo" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "La protectora no está pendiente de validación." });
    expect((await shelterState(shelter.id)).validation_status).toBe("VALIDATED");
  });
});

describe("T-11 CU-39 POST /api/admin/shelters/:id/revoke", () => {
  it("RN-19: revokes a validated shelter, which goes back to rejected with the reason", async () => {
    const shelter = await createShelter({ validationStatus: "VALIDATED" });

    const res = await post(`${base(shelter.id)}/revoke`, adminCookie, { reason: "Ha dejado de cumplir los requisitos." });

    expect(res.status).toBe(200);
    expect(res.body.shelter).toMatchObject({ validationStatus: "REJECTED", validationReason: "Ha dejado de cumplir los requisitos." });
    expect((await shelterState(shelter.id)).validation_status).toBe("REJECTED");
    expect(await auditEntries()).toEqual([
      expect.objectContaining({
        action: "SHELTER_VALIDATION_REVOKED",
        actor_user_id: admin.id,
        entity_id: shelter.id,
        details: {
          before: { validationStatus: "VALIDATED" },
          after: { validationStatus: "REJECTED", validationReason: "Ha dejado de cumplir los requisitos." },
        },
      }),
    ]);
  });

  it("RN-23: revoking keeps the pets, visits in progress as they were", async () => {
    const shelter = await createShelter({ validationStatus: "VALIDATED" });
    const adopter = await createAdopter();
    const pet = await createPet({ shelterId: shelter.id });
    const slot = await createVisitSlot({ shelterId: shelter.id });
    const visit = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: pet.id, slotId: slot.id, status: "CONFIRMED" });

    await post(`${base(shelter.id)}/revoke`, adminCookie, { reason: "Motivo" });

    const { rows: pets } = await getPool().query(`SELECT status FROM "Pet" WHERE id = $1`, [pet.id]);
    const { rows: visits } = await getPool().query(`SELECT status FROM "Visit" WHERE id = $1`, [visit.id]);
    expect(pets).toEqual([{ status: "AVAILABLE" }]);
    expect(visits).toEqual([{ status: "CONFIRMED" }]);
  });

  it("CU-39: revoking requires a reason", async () => {
    const shelter = await createShelter({ validationStatus: "VALIDATED" });

    const res = await post(`${base(shelter.id)}/revoke`, adminCookie, { reason: "" });

    expect(res.status).toBe(400);
    expect(res.body.fields).toMatchObject({ reason: "Indica el motivo." });
    expect((await shelterState(shelter.id)).validation_status).toBe("VALIDATED");
  });

  it("CU-39: rejects revoking a shelter that is not validated", async () => {
    const pending = await createShelter({ validationStatus: "PENDING" });
    const rejected = await createShelter({ validationStatus: "REJECTED" });

    for (const shelter of [pending, rejected]) {
      const res = await post(`${base(shelter.id)}/revoke`, adminCookie, { reason: "Motivo" });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: "La protectora no está validada." });
    }
  });
});
