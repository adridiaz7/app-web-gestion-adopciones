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

const action = (id: number | string, name: "unlist" | "reactivate", body: object = {}, as = cookie) =>
  request(createApp()).post(`/api/shelter/pets/${String(id)}/${name}`).set("Cookie", as).send(body);

/** A visit of a new adopter to `pet` with that status, in a new slot a week ahead. */
async function visitOf(pet: number, status: "PENDING" | "CONFIRMED" = "PENDING", adopterId?: number): Promise<{ id: number; adopterId: number }> {
  const adopter = adopterId ?? (await createAdopter()).id;
  const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() + 7 * DAY) });
  const { id } = await createVisit({ adopterId: adopter, shelterId: shelter.id, petId: pet, slotId: slot.id, status });
  return { id, adopterId: adopter };
}

/** An adoption of `pet` by a new adopter, enabled by a completed visit. */
async function adoptionOf(pet: number, status: "PENDING" | "APPROVED" = "PENDING"): Promise<{ id: number; adopterId: number }> {
  const enabling = await visitOf(pet, "CONFIRMED");
  await getPool().query(
    `UPDATE "Visit" SET status = 'COMPLETED', attendance_marked_by = 'SYSTEM', attendance_marked_at = now() WHERE id = $1`,
    [enabling.id],
  );
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO "Adoption" (adopter_id, pet_id, visit_id, questionnaire_answers, status, decided_at)
     VALUES ($1, $2, $3, '{}', $4, CASE WHEN $4 <> 'PENDING' THEN now() END) RETURNING id`,
    [enabling.adopterId, pet, enabling.id, status],
  );
  return { id: rows[0]?.id ?? 0, adopterId: enabling.adopterId };
}

async function pet(id = petId): Promise<{ status: string; unlist_reason: string | null; unlisted: boolean }> {
  const { rows } = await getPool().query<{ status: string; unlist_reason: string | null; unlisted: boolean }>(
    `SELECT status, unlist_reason, unlisted_at IS NOT NULL AS unlisted FROM "Pet" WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error("pet not found");
  return row;
}

async function row(table: "Visit" | "Adoption", id: number): Promise<{ status: string; void_reason: string | null }> {
  const { rows } = await getPool().query<{ status: string; void_reason: string | null }>(
    `SELECT status, void_reason FROM "${table}" WHERE id = $1`,
    [id],
  );
  const found = rows[0];
  if (!found) throw new Error("row not found");
  return found;
}

async function notifications(): Promise<{ user_id: number; type: string; body: string; visit_id: number | null; adoption_id: number | null; pet_id: number | null }[]> {
  const { rows } = await getPool().query<{ user_id: number; type: string; body: string; visit_id: number | null; adoption_id: number | null; pet_id: number | null }>(
    `SELECT user_id, type, body, visit_id, adoption_id, pet_id FROM "Notification" ORDER BY id`,
  );
  return rows;
}

async function audits(): Promise<{ action: string; entity_type: string; entity_id: number; actor_user_id: number | null; details: unknown }[]> {
  const { rows } = await getPool().query<{ action: string; entity_type: string; entity_id: number; actor_user_id: number | null; details: unknown }>(
    `SELECT action, entity_type, entity_id, actor_user_id, details FROM "Audit_log" ORDER BY id`,
  );
  return rows;
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter();
  cookie = await sessionCookie(shelter.id);
  petId = (await createPet({ shelterId: shelter.id, name: "Luna" })).id;
});

describe("T-27 CU-17 POST /api/shelter/pets/:id/unlist", () => {
  it("RN-60, RN-62, CU-17: unlists an available pet with a reason; it stays in the database and is hidden from adopters", async () => {
    const res = await action(petId, "unlist", { reason: "FOSTER" });

    expect(res.status).toBe(200);
    expect(res.body.pet).toMatchObject({ id: petId, status: "UNLISTED", unlistReason: "FOSTER" });
    expect(await pet()).toEqual({ status: "UNLISTED", unlist_reason: "FOSTER", unlisted: true });
    const gallery = await request(createApp()).get("/api/pets");
    expect(gallery.status).toBe(200);
    expect(JSON.stringify(gallery.body)).not.toContain("Luna");
    expect(await audits()).toEqual([
      {
        action: "PET_STATUS_CHANGED",
        entity_type: "Pet",
        entity_id: petId,
        actor_user_id: shelter.id,
        details: { before: { status: "AVAILABLE" }, after: { status: "UNLISTED", unlistReason: "FOSTER" } },
      },
    ]);
  });

  it("RN-65, RN-110, CU-17: voids the pet's pending and confirmed visits and pending adoptions, and notifies each adopter", async () => {
    const pending = await visitOf(petId, "PENDING");
    const confirmed = await visitOf(petId, "CONFIRMED");
    const adoption = await adoptionOf(petId);

    expect((await action(petId, "unlist", { reason: "TREATMENT" })).status).toBe(200);

    expect(await row("Visit", pending.id)).toEqual({ status: "VOIDED", void_reason: "PET_UNLISTED" });
    expect(await row("Visit", confirmed.id)).toEqual({ status: "VOIDED", void_reason: "PET_UNLISTED" });
    expect(await row("Adoption", adoption.id)).toEqual({ status: "VOIDED", void_reason: "PET_UNLISTED" });
    const sent = await notifications();
    expect(sent).toEqual([
      expect.objectContaining({ user_id: pending.adopterId, type: "VISIT_VOIDED_PET_UNLISTED", visit_id: pending.id }),
      expect.objectContaining({ user_id: confirmed.adopterId, type: "VISIT_VOIDED_PET_UNLISTED", visit_id: confirmed.id }),
      expect.objectContaining({ user_id: adoption.adopterId, type: "ADOPTION_VOIDED_PET_UNLISTED", adoption_id: adoption.id }),
    ]);
    const actions = (await audits()).map((entry) => `${entry.action} ${entry.entity_type}`);
    expect(actions).toEqual(["PET_STATUS_CHANGED Pet", "VISIT_VOIDED Visit", "VISIT_VOIDED Visit", "ADOPTION_VOIDED Adoption"]);
  });

  it("RN-66: the adopter's message comes from a template for each reason, with no free text", async () => {
    const bodies: Record<string, string> = {};
    for (const reason of ["DECEASED", "TRANSFERRED", "TREATMENT", "FOSTER", "ERROR", "OTHER"]) {
      const id = (await createPet({ shelterId: shelter.id, name: "Luna" })).id;
      const visit = await visitOf(id);
      expect((await action(id, "unlist", { reason, message: "texto libre" })).status, reason).toBe(200);
      const sent = (await notifications()).find((n) => n.visit_id === visit.id);
      expect(sent?.body, reason).toContain("Luna");
      expect(sent?.body, reason).not.toContain("texto libre");
      bodies[reason] = sent?.body ?? "";
    }
    expect(new Set(Object.values(bodies)).size).toBe(6);
  });

  it("CU-17: closed visits and adoptions are left as they were", async () => {
    const cancelled = await visitOf(petId);
    await getPool().query(`UPDATE "Visit" SET status = 'CANCELLED', cancelled_by = 'ADOPTER', cancelled_at = now() WHERE id = $1`, [cancelled.id]);

    expect((await action(petId, "unlist", { reason: "OTHER" })).status).toBe(200);

    expect((await row("Visit", cancelled.id)).status).toBe("CANCELLED");
    expect(await notifications()).toEqual([]);
  });

  it("RN-61, CU-17: a reserved pet cannot be unlisted until the approved adoption is cancelled", async () => {
    await adoptionOf(petId, "APPROVED");
    await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [petId]);

    const res = await action(petId, "unlist", { reason: "OTHER" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "La mascota está reservada: primero cancela la adopción aprobada." });
    expect((await pet()).status).toBe("RESERVED");
  });

  it("RN-61, CU-17: only an available pet can be unlisted", async () => {
    await getPool().query(`UPDATE "Pet" SET status = 'ADOPTED' WHERE id = $1`, [petId]);
    const adopted = await action(petId, "unlist", { reason: "OTHER" });
    expect(adopted.status).toBe(409);
    expect(adopted.body).toEqual({ error: "Solo se puede dar de baja una mascota disponible." });

    const other = (await createPet({ shelterId: shelter.id })).id;
    await action(other, "unlist", { reason: "OTHER" });
    const again = await action(other, "unlist", { reason: "ERROR" });
    expect(again.status).toBe(409);
    expect((await pet(other)).unlist_reason).toBe("OTHER");
  });

  it("RN-62, CU-17: the reason is required, and REMOVED_BY_ADMIN is only for the administrator", async () => {
    for (const body of [{}, { reason: "" }, { reason: "LOST" }, { reason: "REMOVED_BY_ADMIN" }]) {
      const res = await action(petId, "unlist", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await pet()).status).toBe("AVAILABLE");
  });

  it("CU-17: a shelter cannot unlist another shelter's pet, and only shelters can", async () => {
    const other = await createShelter();
    const res = await action(petId, "unlist", { reason: "OTHER" }, await sessionCookie(other.id));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "La mascota no existe." });

    const adopter = await createAdopter();
    expect((await action(petId, "unlist", { reason: "OTHER" }, await sessionCookie(adopter.id))).status).toBe(403);
    expect((await action("abc", "unlist", { reason: "OTHER" })).status).toBe(400);
    expect((await pet()).status).toBe("AVAILABLE");
  });
});

describe("T-27 CU-17 POST /api/shelter/pets/:id/reactivate", () => {
  it("RN-63, RN-67, CU-17: reactivates an unlisted pet and notifies the adopters whose visits or adoptions that unlisting voided", async () => {
    const visit = await visitOf(petId, "CONFIRMED");
    const adoption = await adoptionOf(petId);
    await action(petId, "unlist", { reason: "TREATMENT" });
    await getPool().query(`DELETE FROM "Notification"`);
    await getPool().query(`DELETE FROM "Audit_log"`);

    const res = await action(petId, "reactivate");

    expect(res.status).toBe(200);
    expect(res.body.pet).toMatchObject({ id: petId, status: "AVAILABLE", unlistReason: null });
    expect(await pet()).toEqual({ status: "AVAILABLE", unlist_reason: null, unlisted: false });
    const sent = await notifications();
    expect(sent.map((n) => [n.user_id, n.type, n.pet_id])).toEqual([
      [visit.adopterId, "PET_AVAILABLE_AGAIN", petId],
      [adoption.adopterId, "PET_AVAILABLE_AGAIN", petId],
    ]);
    expect(await audits()).toEqual([
      {
        action: "PET_STATUS_CHANGED",
        entity_type: "Pet",
        entity_id: petId,
        actor_user_id: shelter.id,
        details: { before: { status: "UNLISTED", unlistReason: "TREATMENT" }, after: { status: "AVAILABLE" } },
      },
    ]);
  });

  it("RN-67: adopters voided by an earlier unlisting or for another reason are not notified, and each adopter only once", async () => {
    const earlier = await visitOf(petId);
    await action(petId, "unlist", { reason: "TREATMENT" });
    await action(petId, "reactivate");
    const blocked = await visitOf(petId);
    await getPool().query(`UPDATE "Visit" SET status = 'VOIDED', void_reason = 'ADOPTER_BLOCKED', voided_at = now() WHERE id = $1`, [blocked.id]);
    const twice = await visitOf(petId);
    await visitOf(petId, "PENDING", twice.adopterId);
    await action(petId, "unlist", { reason: "OTHER" });
    await getPool().query(`DELETE FROM "Notification"`);

    expect((await action(petId, "reactivate")).status).toBe(200);

    expect((await notifications()).map((n) => n.user_id)).toEqual([twice.adopterId]);
    expect(earlier.adopterId).not.toBe(twice.adopterId);
  });

  it("CU-17: a pet that is not unlisted cannot be reactivated", async () => {
    const res = await action(petId, "reactivate");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "La mascota no está de baja." });
  });

  it("RN-64, CU-17: a pet removed by the administrator cannot be reactivated by the shelter", async () => {
    await getPool().query(`UPDATE "Pet" SET status = 'UNLISTED', unlist_reason = 'REMOVED_BY_ADMIN', unlisted_at = now() WHERE id = $1`, [petId]);

    const res = await action(petId, "reactivate");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "La mascota fue retirada por el administrador y no se puede reactivar." });
    expect((await pet()).status).toBe("UNLISTED");
  });

  it("CU-17: a shelter cannot reactivate another shelter's pet", async () => {
    await action(petId, "unlist", { reason: "OTHER" });
    const other = await createShelter();

    const res = await action(petId, "reactivate", {}, await sessionCookie(other.id));

    expect(res.status).toBe(404);
    expect((await pet()).status).toBe("UNLISTED");
  });
});

describe("T-27 CU-14 GET /api/shelter/pets", () => {
  it("RN-62: the shelter's list shows the reason of an unlisted pet", async () => {
    await action(petId, "unlist", { reason: "DECEASED" });

    const res = await request(createApp()).get("/api/shelter/pets").set("Cookie", cookie);

    expect(res.body.pets[0]).toMatchObject({ id: petId, status: "UNLISTED", unlistReason: "DECEASED" });
  });
});
