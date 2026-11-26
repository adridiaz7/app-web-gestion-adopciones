import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const DAY = 24 * 60 * 60 * 1000;

let shelter: CreatedUser;
let cookie: string;
let petId: number;

const post = (path: string, body: object = {}, as = cookie) => request(createApp()).post(path).set("Cookie", as).send(body);
const decide = (id: number, action: "approve" | "reject", body: object = {}, as = cookie) => post(`/api/shelter/adoptions/${String(id)}/${action}`, body, as);

/** A pending adoption of `pet` by a new adopter (with household data), enabled by a completed visit. */
async function candidate(pet = petId, answers: object = { reason: "Me encanta" }): Promise<{ id: number; adopterId: number }> {
  const adopter = await createAdopter();
  await getPool().query(
    `UPDATE "Adopter" SET housing_type = 'HOUSE', has_outdoor_space = true, housing_tenure = 'OWNED', household_members = 2,
            has_children = false, has_other_pets = false, has_pet_experience = true, hours_alone_per_day = 3 WHERE user_id = $1`,
    [adopter.id],
  );
  const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() - 3 * DAY) });
  const visit = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: pet, slotId: slot.id, status: "CONFIRMED" });
  await getPool().query(`UPDATE "Visit" SET status = 'COMPLETED', attendance_marked_by = 'SYSTEM', attendance_marked_at = now() WHERE id = $1`, [visit.id]);
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO "Adoption" (adopter_id, pet_id, visit_id, questionnaire_answers) VALUES ($1, $2, $3, $4) RETURNING id`,
    [adopter.id, pet, visit.id, JSON.stringify(answers)],
  );
  return { id: rows[0]?.id ?? 0, adopterId: adopter.id };
}

async function status(table: "Adoption" | "Visit" | "Pet", id: number): Promise<string> {
  const { rows } = await getPool().query<{ status: string }>(`SELECT status FROM "${table}" WHERE id = $1`, [id]);
  return rows[0]?.status ?? "";
}

async function notifications(): Promise<{ user_id: number; type: string; body: string }[]> {
  const { rows } = await getPool().query<{ user_id: number; type: string; body: string }>(`SELECT user_id, type, body FROM "Notification" ORDER BY id`);
  return rows;
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter();
  cookie = await sessionCookie(shelter.id);
  petId = (await createPet({ shelterId: shelter.id, name: "Luna" })).id;
});

describe("T-31 CU-28 GET /api/shelter/pets/:id/candidates", () => {
  it("RN-121, CU-28: lists the pet's pending requests with each candidate's personal and household data and answers", async () => {
    const first = await candidate();
    const second = await candidate(petId, {});
    const rejected = await candidate();
    await getPool().query(`UPDATE "Adoption" SET status = 'REJECTED', rejection_reason = 'No', decided_at = now() WHERE id = $1`, [rejected.id]);

    const res = await request(createApp()).get(`/api/shelter/pets/${String(petId)}/candidates`).set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.pet).toMatchObject({ id: petId, name: "Luna", status: "AVAILABLE" });
    expect(res.body.candidates.map((c: { adoptionId: number }) => c.adoptionId)).toEqual([first.id, second.id]);
    expect(res.body.candidates[0]).toMatchObject({
      adopterId: first.adopterId,
      name: expect.any(String),
      email: expect.any(String),
      phone: expect.any(String),
      provinceName: expect.any(String),
      locality: expect.any(String),
      household: { housingType: "HOUSE", hasOutdoorSpace: true, housingTenure: "OWNED", householdMembers: 2, hasChildren: false, hasOtherPets: false, otherPetsDescription: null, hasPetExperience: true, hoursAlonePerDay: 3 },
      answers: { reason: "Me encanta" },
      visitedAt: expect.any(String),
      requestedAt: expect.any(String),
    });
  });

  it("CU-28: with no pending requests the list is empty; another shelter's pet is not found", async () => {
    const res = await request(createApp()).get(`/api/shelter/pets/${String(petId)}/candidates`).set("Cookie", cookie);
    expect(res.body.candidates).toEqual([]);

    const other = await createShelter();
    const foreign = await request(createApp()).get(`/api/shelter/pets/${String(petId)}/candidates`).set("Cookie", await sessionCookie(other.id));
    expect(foreign.status).toBe(404);
  });
});

describe("T-31 CU-29 POST /api/shelter/adoptions/:id/approve", () => {
  it("RN-124, CU-29: approving reserves the pet, the other candidates are not selected, the pet's open visits are voided and everyone is told", async () => {
    const chosen = await candidate();
    const other = await candidate();
    const visitor = await createAdopter();
    const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() + 5 * DAY) });
    const openVisit = await createVisit({ adopterId: visitor.id, shelterId: shelter.id, petId, slotId: slot.id });

    const res = await decide(chosen.id, "approve");

    expect(res.status).toBe(200);
    expect(res.body.adoption).toEqual({ id: chosen.id, status: "APPROVED" });
    expect(await status("Adoption", chosen.id)).toBe("APPROVED");
    expect(await status("Adoption", other.id)).toBe("NOT_SELECTED");
    expect(await status("Pet", petId)).toBe("RESERVED");
    expect(await status("Visit", openVisit.id)).toBe("VOIDED");
    const { rows } = await getPool().query<{ void_reason: string }>(`SELECT void_reason FROM "Visit" WHERE id = $1`, [openVisit.id]);
    expect(rows[0]?.void_reason).toBe("PET_RESERVED");
    expect((await notifications()).map((n) => [n.user_id, n.type])).toEqual([
      [chosen.adopterId, "ADOPTION_APPROVED"],
      [other.adopterId, "ADOPTION_NOT_SELECTED"],
      [visitor.id, "VISIT_VOIDED_PET_RESERVED"],
    ]);
    const audits = await getPool().query<{ action: string }>(`SELECT action FROM "Audit_log" ORDER BY id`);
    expect(audits.rows.map((r) => r.action)).toEqual(["ADOPTION_APPROVED", "PET_STATUS_CHANGED", "ADOPTION_NOT_SELECTED", "VISIT_VOIDED"]);
  });

  it("CU-29: only a pending request can be approved", async () => {
    const adoption = await candidate();
    await getPool().query(`UPDATE "Adoption" SET status = 'CANCELLED', cancelled_by = 'ADOPTER', cancelled_at = now() WHERE id = $1`, [adoption.id]);

    const res = await decide(adoption.id, "approve");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "La solicitud no está pendiente." });
    expect(await status("Pet", petId)).toBe("AVAILABLE");
  });

  it("RN-125, CU-29: a pet with another approved or completed adoption cannot get a second one", async () => {
    const first = await candidate();
    const second = await candidate();
    expect((await decide(first.id, "approve")).status).toBe(200);
    // A pending request that slipped through (for instance, created by another path): it must not be approved.
    await getPool().query(`UPDATE "Adoption" SET status = 'PENDING', decided_at = NULL WHERE id = $1`, [second.id]);

    const res = await decide(second.id, "approve");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Luna ya tiene una adopción aprobada o completada." });
  });

  it("CU-29: a shelter cannot decide on another shelter's adoptions, and only shelters decide", async () => {
    const adoption = await candidate();
    const other = await createShelter();
    expect((await decide(adoption.id, "approve", {}, await sessionCookie(other.id))).status).toBe(404);
    expect((await decide(adoption.id, "reject", { reason: "No" }, await sessionCookie(other.id))).status).toBe(404);
    expect((await decide(adoption.id, "approve", {}, await sessionCookie(adoption.adopterId))).status).toBe(403);
    expect((await post("/api/shelter/adoptions/abc/approve")).status).toBe(400);
    expect(await status("Adoption", adoption.id)).toBe("PENDING");
  });
});

describe("T-31 CU-29 POST /api/shelter/adoptions/:id/reject", () => {
  it("RN-123, CU-29: rejects a pending request with a reason, which the adopter is told", async () => {
    const adoption = await candidate();

    const res = await decide(adoption.id, "reject", { reason: "  Buscamos una casa con jardín.  " });

    expect(res.status).toBe(200);
    expect(res.body.adoption).toEqual({ id: adoption.id, status: "REJECTED" });
    const { rows } = await getPool().query<{ status: string; rejection_reason: string; decided: boolean }>(
      `SELECT status, rejection_reason, decided_at IS NOT NULL AS decided FROM "Adoption" WHERE id = $1`,
      [adoption.id],
    );
    expect(rows[0]).toEqual({ status: "REJECTED", rejection_reason: "Buscamos una casa con jardín.", decided: true });
    expect(await notifications()).toEqual([
      { user_id: adoption.adopterId, type: "ADOPTION_REJECTED", body: expect.stringContaining("Motivo: Buscamos una casa con jardín.") },
    ]);
    expect(await status("Pet", petId)).toBe("AVAILABLE");
  });

  it("RN-123: the reason is required", async () => {
    const adoption = await candidate();
    for (const body of [{}, { reason: "   " }, { reason: "x".repeat(1001) }]) {
      expect((await decide(adoption.id, "reject", body)).status).toBe(400);
    }
    expect(await status("Adoption", adoption.id)).toBe("PENDING");
  });

  it("CU-29: only a pending request can be rejected", async () => {
    const adoption = await candidate();
    await decide(adoption.id, "approve");

    const res = await decide(adoption.id, "reject", { reason: "Mejor no" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "La solicitud no está pendiente." });
  });
});

describe("T-31 CU-28, CU-29 permissions", () => {
  it("CU-28, CU-29: comparing, approving and rejecting need a session", async () => {
    const { id } = await candidate();
    const app = createApp();
    expect((await request(app).get(`/api/shelter/pets/${String(petId)}/candidates`)).status).toBe(401);
    expect((await request(app).post(`/api/shelter/adoptions/${String(id)}/approve`).send({})).status).toBe(401);
    expect((await request(app).post(`/api/shelter/adoptions/${String(id)}/reject`).send({ reason: "Motivo" })).status).toBe(401);
    expect(await status("Adoption", id)).toBe("PENDING");
    expect(await status("Pet", petId)).toBe("AVAILABLE");
    expect(await notifications()).toEqual([]);
  });
});
