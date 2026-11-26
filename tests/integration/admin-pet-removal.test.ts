import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const DAY = 24 * 60 * 60 * 1000;

let admin: CreatedUser;
let shelter: CreatedUser;
let adopter: CreatedUser;
let adminCookie: string;
let petId: number;

const removePet = (id = petId, as = adminCookie) => request(createApp()).post(`/api/admin/pets/${String(id)}/remove`).set("Cookie", as);
const pet = async () => (await getPool().query(`SELECT status, unlist_reason FROM "Pet" WHERE id = $1`, [petId])).rows[0];

beforeEach(async () => {
  await truncateAll();
  admin = await createAdmin();
  adminCookie = await sessionCookie(admin.id);
  shelter = await createShelter();
  adopter = await createAdopter();
  petId = (await createPet({ shelterId: shelter.id, name: "Luna" })).id;
});

describe("T-40 CU-41 POST /api/admin/pets/:id/remove", () => {
  it("RN-163, RN-208: the administrator removes an available pet (UNLISTED, REMOVED_BY_ADMIN), audited", async () => {
    const res = await removePet();

    expect(res.status).toBe(204);
    expect(await pet()).toEqual({ status: "UNLISTED", unlist_reason: "REMOVED_BY_ADMIN" });
    const { rows } = await getPool().query(`SELECT actor_user_id, action, entity_id FROM "Audit_log" WHERE entity_type = 'Pet'`);
    expect(rows).toEqual([{ actor_user_id: admin.id, action: "PET_STATUS_CHANGED", entity_id: petId }]);
  });

  it("RN-163, RN-65: its open visits and pending adoptions are voided (PET_UNLISTED) and the adopters are told", async () => {
    const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() + 5 * DAY) });
    const { id: visitId } = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId, slotId: slot.id, status: "CONFIRMED" });

    expect((await removePet()).status).toBe(204);

    expect((await getPool().query(`SELECT status, void_reason FROM "Visit" WHERE id = $1`, [visitId])).rows[0]).toEqual({
      status: "VOIDED",
      void_reason: "PET_UNLISTED",
    });
    const { rows } = await getPool().query<{ type: string }>(`SELECT type FROM "Notification" WHERE user_id = $1`, [adopter.id]);
    expect(rows.map((r) => r.type)).toContain("VISIT_VOIDED_PET_UNLISTED");
  });

  it("RN-64, CU-41: the shelter cannot reactivate a removed pet", async () => {
    await removePet();

    const res = await request(createApp()).post(`/api/shelter/pets/${String(petId)}/reactivate`).set("Cookie", await sessionCookie(shelter.id));

    expect(res.status).toBe(409);
    expect(await pet()).toEqual({ status: "UNLISTED", unlist_reason: "REMOVED_BY_ADMIN" });
  });

  it("RN-163, CU-41: only an available pet can be removed", async () => {
    await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [petId]);

    const res = await removePet();

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Solo se puede retirar una mascota disponible." });
    expect(await pet()).toEqual({ status: "RESERVED", unlist_reason: null });
  });

  it("CU-41: an unknown pet answers 404", async () => {
    expect((await removePet(999_999)).status).toBe(404);
  });

  it("CU-41: only the administrator removes pets, and a session is required", async () => {
    expect((await request(createApp()).post(`/api/admin/pets/${String(petId)}/remove`)).status).toBe(401);
    expect((await removePet(petId, await sessionCookie(shelter.id))).status).toBe(403);
    expect((await removePet(petId, await sessionCookie(adopter.id))).status).toBe(403);
    expect(await pet()).toEqual({ status: "AVAILABLE", unlist_reason: null });
  });
});
