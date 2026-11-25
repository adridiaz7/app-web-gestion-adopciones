import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createPet, createShelter, type CreatedUser } from "../helpers/factories.js";

const validatePath = (id: number) => `/api/admin/shelters/${String(id)}/validate`;

let admin: CreatedUser;
let adminCookie: string;

beforeEach(async () => {
  await truncateAll();
  admin = await createAdmin();
  adminCookie = await sessionCookie(admin.id);
});

async function galleryNames(): Promise<string[]> {
  const res = await request(createApp()).get("/api/pets");
  expect(res.status).toBe(200);
  return (res.body.pets as { name: string }[]).map((pet) => pet.name);
}

describe("T-45 CU-39 POST /api/admin/shelters/:id/validate on a rejected shelter", () => {
  it("CU-39, RN-19: validates a rejected (or revoked) shelter, clears the reason and records it in the audit log (RN-208)", async () => {
    const shelter = await createShelter({ validationStatus: "REJECTED" });

    const res = await request(createApp()).post(validatePath(shelter.id)).set("Cookie", adminCookie).send({});

    expect(res.status).toBe(200);
    expect(res.body.shelter).toMatchObject({ id: shelter.id, validationStatus: "VALIDATED", validationReason: null });
    const { rows } = await getPool().query(
      `SELECT validation_status, validation_reason, validated_at IS NOT NULL AS validated FROM "Shelter" WHERE user_id = $1`,
      [shelter.id],
    );
    expect(rows).toEqual([{ validation_status: "VALIDATED", validation_reason: null, validated: true }]);
    const { rows: audit } = await getPool().query(`SELECT action, actor_user_id, entity_type, entity_id, details FROM "Audit_log"`);
    expect(audit).toEqual([
      {
        action: "SHELTER_VALIDATED",
        actor_user_id: admin.id,
        entity_type: "Shelter",
        entity_id: shelter.id,
        details: { before: { validationStatus: "REJECTED" }, after: { validationStatus: "VALIDATED" } },
      },
    ]);
  });

  it("RN-23: the pets of a revoked shelter become visible again when it is validated again", async () => {
    const shelter = await createShelter({ validationStatus: "VALIDATED" });
    await createPet({ shelterId: shelter.id, name: "Kira" });
    const post = (path: string, body: object = {}) => request(createApp()).post(path).set("Cookie", adminCookie).send(body);

    expect((await post(`/api/admin/shelters/${String(shelter.id)}/revoke`, { reason: "Documentación caducada." })).status).toBe(200);
    expect(await galleryNames()).toEqual([]);

    expect((await post(validatePath(shelter.id))).status).toBe(200);
    expect(await galleryNames()).toEqual(["Kira"]);
  });
});
