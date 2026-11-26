import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { hashPassword } from "../../src/server/services/passwords.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = "contraseña-de-prueba";
let passwordHash: string;

let shelter: CreatedUser;
let adopter: CreatedUser;

const remove = (as: string, body: object = { password: PASSWORD }) => request(createApp()).post("/api/auth/delete-account").set("Cookie", as).send(body);

/** A visit of `adopterId` to the pet, `days` from now, with that status. */
async function visit(adopterId: number, petId: number, status: "PENDING" | "CONFIRMED", days = 5): Promise<number> {
  const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() + days * DAY) });
  return (await createVisit({ adopterId, shelterId: shelter.id, petId, slotId: slot.id, status })).id;
}

/** An adoption of the pet by `adopterId`, enabled by a completed visit; an APPROVED one reserves the pet. */
async function adoption(adopterId: number, petId: number, status: "PENDING" | "APPROVED" | "NOT_SELECTED" | "COMPLETED"): Promise<number> {
  const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() - 3 * DAY) });
  const v = await createVisit({ adopterId, shelterId: shelter.id, petId, slotId: slot.id, status: "CONFIRMED" });
  await getPool().query(`UPDATE "Visit" SET status = 'COMPLETED', attendance_marked_by = 'SYSTEM', attendance_marked_at = now() WHERE id = $1`, [v.id]);
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO "Adoption" (adopter_id, pet_id, visit_id, questionnaire_answers, status, decided_at, delivered_at)
     VALUES ($1, $2, $3, '{}', $4, CASE WHEN $4 <> 'PENDING' THEN now() END, CASE WHEN $4 = 'COMPLETED' THEN now() END) RETURNING id`,
    [adopterId, petId, v.id, status],
  );
  if (status === "APPROVED") await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [petId]);
  if (status === "COMPLETED") await getPool().query(`UPDATE "Pet" SET status = 'ADOPTED' WHERE id = $1`, [petId]);
  return rows[0]?.id ?? 0;
}

async function row<T>(sql: string, params: unknown[]): Promise<T> {
  const { rows } = await getPool().query(sql, params);
  return rows[0] as T;
}

const visitStatus = (id: number) => row<{ status: string; void_reason: string | null }>(`SELECT status, void_reason FROM "Visit" WHERE id = $1`, [id]);
const adoptionStatus = (id: number) => row<{ status: string; void_reason: string | null }>(`SELECT status, void_reason FROM "Adoption" WHERE id = $1`, [id]);
const petStatus = (id: number) => row<{ status: string; unlist_reason: string | null }>(`SELECT status, unlist_reason FROM "Pet" WHERE id = $1`, [id]);
const notificationTypes = async (userId: number): Promise<string[]> =>
  (await getPool().query<{ type: string }>(`SELECT type FROM "Notification" WHERE user_id = $1 ORDER BY id`, [userId])).rows.map((r) => r.type);

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter({ name: "Huellas", passwordHash });
  adopter = await createAdopter({ firstName: "Ane", lastName: "Etxeberria", passwordHash });
});

describe("T-37 CU-07 POST /api/auth/delete-account · confirmation and access", () => {
  it("CU-07: without the current password nothing is deleted", async () => {
    const cookie = await sessionCookie(adopter.id);

    const missing = await remove(cookie, {});
    const wrong = await remove(cookie, { password: "otra-contraseña" });

    expect(missing.status).toBe(400);
    expect(wrong.status).toBe(400);
    expect(wrong.body).toEqual({ error: "La contraseña no es correcta." });
    expect(await row(`SELECT deleted_at, email FROM "App_user" WHERE id = $1`, [adopter.id])).toEqual({ deleted_at: null, email: adopter.email });
    expect((await request(createApp()).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);
  });

  it("CU-07: a session is required, and the administrator cannot delete their account", async () => {
    expect((await request(createApp()).post("/api/auth/delete-account").send({ password: PASSWORD })).status).toBe(401);
    const admin = await createAdmin({ passwordHash });
    expect((await remove(await sessionCookie(admin.id))).status).toBe(403);
    expect(await row(`SELECT deleted_at FROM "App_user" WHERE id = $1`, [admin.id])).toEqual({ deleted_at: null });
  });

  it("RN-11, RN-211: the account is deleted, its sessions are closed and it cannot log in again", async () => {
    const cookie = await sessionCookie(adopter.id);
    const other = await sessionCookie(adopter.id);

    const res = await remove(cookie);

    expect(res.status).toBe(204);
    expect(String(res.headers["set-cookie"])).toMatch(/lagun_session=;/);
    expect((await request(createApp()).get("/api/auth/me").set("Cookie", other)).status).toBe(401);
    expect(await row(`SELECT count(*)::int AS n FROM "Session" WHERE user_id = $1`, [adopter.id])).toEqual({ n: 0 });
    const login = await request(createApp()).post("/api/auth/login").send({ email: adopter.email, password: PASSWORD });
    expect(login.status).toBe(401);
  });

  it("RN-208: the deletion is audited", async () => {
    await remove(await sessionCookie(adopter.id));

    const { rows } = await getPool().query(`SELECT actor_user_id, entity_type, entity_id FROM "Audit_log" WHERE action = 'ACCOUNT_DELETED'`);
    expect(rows).toEqual([{ actor_user_id: adopter.id, entity_type: "App_user", entity_id: adopter.id }]);
  });
});

describe("T-37 CU-07 deleting an adopter", () => {
  it("RN-11, RN-12: the personal and household data are anonymised, and the email is free again", async () => {
    await getPool().query(`UPDATE "Adopter" SET housing_type = 'HOUSE', has_children = true, other_pets_description = 'Un gato' WHERE user_id = $1`, [adopter.id]);

    expect((await remove(await sessionCookie(adopter.id))).status).toBe(204);

    const user = await row<{ email: string; password_hash: string; deleted_at: Date | null }>(
      `SELECT email, password_hash, deleted_at FROM "App_user" WHERE id = $1`,
      [adopter.id],
    );
    expect(user.email).toBe(`deleted-${String(adopter.id)}@deleted.invalid`);
    expect(user.password_hash).not.toBe(passwordHash);
    expect(user.deleted_at).not.toBeNull();
    expect(
      await row(
        `SELECT first_name, last_name, phone, locality, housing_type, has_children, other_pets_description, hours_alone_per_day FROM "Adopter" WHERE user_id = $1`,
        [adopter.id],
      ),
    ).toEqual({
      first_name: "Usuario eliminado",
      last_name: "",
      phone: "",
      locality: "",
      housing_type: null,
      has_children: null,
      other_pets_description: null,
      hours_alone_per_day: null,
    });
    // The email is free for a new account.
    expect(await row(`SELECT count(*)::int AS n FROM "App_user" WHERE lower(email) = lower($1)`, [adopter.email])).toEqual({ n: 0 });
  });

  it("RN-12: the adopter's open visits and open adoptions become VOIDED (ACCOUNT_DELETED); the history stays", async () => {
    const luna = (await createPet({ shelterId: shelter.id, name: "Luna" })).id;
    const kira = (await createPet({ shelterId: shelter.id, name: "Kira" })).id;
    const toby = (await createPet({ shelterId: shelter.id, name: "Toby" })).id;
    const pending = await visit(adopter.id, luna, "PENDING");
    const confirmed = await visit(adopter.id, kira, "CONFIRMED", 6);
    const pendingAdoption = await adoption(adopter.id, luna, "PENDING");
    const done = await adoption(adopter.id, toby, "COMPLETED");

    expect((await remove(await sessionCookie(adopter.id))).status).toBe(204);

    expect(await visitStatus(pending)).toEqual({ status: "VOIDED", void_reason: "ACCOUNT_DELETED" });
    expect(await visitStatus(confirmed)).toEqual({ status: "VOIDED", void_reason: "ACCOUNT_DELETED" });
    expect(await adoptionStatus(pendingAdoption)).toEqual({ status: "VOIDED", void_reason: "ACCOUNT_DELETED" });
    expect(await adoptionStatus(done)).toEqual({ status: "COMPLETED", void_reason: null });
    const audits = await getPool().query(`SELECT action, entity_id FROM "Audit_log" WHERE action IN ('VISIT_VOIDED', 'ADOPTION_VOIDED') ORDER BY id`);
    expect(audits.rows).toEqual([
      { action: "VISIT_VOIDED", entity_id: pending },
      { action: "VISIT_VOIDED", entity_id: confirmed },
      { action: "ADOPTION_VOIDED", entity_id: pendingAdoption },
    ]);
  });

  it("RN-12, RN-130: an approved adoption is voided and its pet is available again for the other candidates", async () => {
    const luna = (await createPet({ shelterId: shelter.id, name: "Luna" })).id;
    const approved = await adoption(adopter.id, luna, "APPROVED");
    const other = await createAdopter();
    await adoption(other.id, luna, "NOT_SELECTED");

    expect((await remove(await sessionCookie(adopter.id))).status).toBe(204);

    expect(await adoptionStatus(approved)).toEqual({ status: "VOIDED", void_reason: "ACCOUNT_DELETED" });
    expect(await petStatus(luna)).toEqual({ status: "AVAILABLE", unlist_reason: null });
    expect(await notificationTypes(other.id)).toContain("PET_AVAILABLE_AGAIN");
  });

  it("RN-13: in the chat the author shows as 'Usuario eliminado' and the shelter can read but no longer write", async () => {
    const { rows } = await getPool().query<{ id: number }>(`INSERT INTO "Conversation" (adopter_id, shelter_id) VALUES ($1, $2) RETURNING id`, [adopter.id, shelter.id]);
    const conversationId = rows[0]?.id ?? 0;
    await getPool().query(`INSERT INTO "Message" (conversation_id, sender_id, body) VALUES ($1, $2, 'Hola')`, [conversationId, adopter.id]);

    await remove(await sessionCookie(adopter.id));

    const shelterCookie = await sessionCookie(shelter.id);
    const read = await request(createApp()).get(`/api/conversations/${String(conversationId)}/messages`).set("Cookie", shelterCookie);
    expect(read.status).toBe(200);
    expect(JSON.stringify(read.body)).toContain("Usuario eliminado");
    expect(JSON.stringify(read.body)).not.toContain("Etxeberria");
    const write = await request(createApp()).post(`/api/conversations/${String(conversationId)}/messages`).set("Cookie", shelterCookie).send({ body: "¿Sigues ahí?" });
    expect(write.status).toBeGreaterThanOrEqual(400);
  });
});

describe("T-37 CU-07 deleting a shelter", () => {
  it("RN-12: available and reserved pets become UNLISTED (ACCOUNT_DELETED); adopted ones stay as they are", async () => {
    const available = (await createPet({ shelterId: shelter.id, name: "Luna" })).id;
    const reserved = (await createPet({ shelterId: shelter.id, name: "Kira" })).id;
    const adopted = (await createPet({ shelterId: shelter.id, name: "Toby" })).id;
    const approved = await adoption(adopter.id, reserved, "APPROVED");
    const done = await adoption(adopter.id, adopted, "COMPLETED");

    expect((await remove(await sessionCookie(shelter.id))).status).toBe(204);

    expect(await petStatus(available)).toEqual({ status: "UNLISTED", unlist_reason: "ACCOUNT_DELETED" });
    expect(await petStatus(reserved)).toEqual({ status: "UNLISTED", unlist_reason: "ACCOUNT_DELETED" });
    expect(await petStatus(adopted)).toEqual({ status: "ADOPTED", unlist_reason: null });
    expect(await adoptionStatus(approved)).toEqual({ status: "VOIDED", void_reason: "ACCOUNT_DELETED" });
    expect(await adoptionStatus(done)).toEqual({ status: "COMPLETED", void_reason: null });
    const audits = await getPool().query(`SELECT entity_id FROM "Audit_log" WHERE action = 'PET_STATUS_CHANGED' ORDER BY entity_id`);
    expect(audits.rows).toEqual([{ entity_id: available }, { entity_id: reserved }]);
  });

  it("RN-12: open visits and pending adoptions become VOIDED (ACCOUNT_DELETED) and each adopter is told", async () => {
    const luna = (await createPet({ shelterId: shelter.id, name: "Luna" })).id;
    const kira = (await createPet({ shelterId: shelter.id, name: "Kira" })).id;
    const pending = await visit(adopter.id, luna, "PENDING");
    const confirmed = await visit(adopter.id, kira, "CONFIRMED", 6);
    const pendingAdoption = await adoption(adopter.id, kira, "PENDING");

    expect((await remove(await sessionCookie(shelter.id))).status).toBe(204);

    expect(await visitStatus(pending)).toEqual({ status: "VOIDED", void_reason: "ACCOUNT_DELETED" });
    expect(await visitStatus(confirmed)).toEqual({ status: "VOIDED", void_reason: "ACCOUNT_DELETED" });
    expect(await adoptionStatus(pendingAdoption)).toEqual({ status: "VOIDED", void_reason: "ACCOUNT_DELETED" });
    const types = await notificationTypes(adopter.id);
    expect(types.filter((t) => t === "VISIT_VOIDED_ACCOUNT_DELETED")).toHaveLength(2);
    expect(types).toContain("ADOPTION_VOIDED_ACCOUNT_DELETED");
    const { rows } = await getPool().query<{ body: string }>(`SELECT body FROM "Notification" WHERE user_id = $1 AND type = 'ADOPTION_VOIDED_ACCOUNT_DELETED'`, [adopter.id]);
    expect(rows[0]?.body).toMatch(/Kira/);
  });

  it("RN-11, RN-12: the shelter's contact data are anonymised, and its CIF is free again", async () => {
    await getPool().query(
      `UPDATE "Shelter" SET description = 'Somos…', logo_path = '/uploads/logo.png', contact_email = 'hola@huellas.test', website = 'https://huellas.test', opening_hours = 'L-V' WHERE user_id = $1`,
      [shelter.id],
    );
    const { cif } = await row<{ cif: string }>(`SELECT cif FROM "Shelter" WHERE user_id = $1`, [shelter.id]);

    expect((await remove(await sessionCookie(shelter.id))).status).toBe(204);

    const data = await row<Record<string, unknown>>(
      `SELECT name, cif, description, logo_path, address, locality, phone, contact_email, website, opening_hours FROM "Shelter" WHERE user_id = $1`,
      [shelter.id],
    );
    expect(data).toEqual({
      name: "Usuario eliminado",
      cif: `DELETED-${String(shelter.id)}`,
      description: null,
      logo_path: null,
      address: "",
      locality: "",
      phone: "",
      contact_email: null,
      website: null,
      opening_hours: null,
    });
    expect(data["cif"]).not.toBe(cif);
  });

  it("RN-24: the deleted shelter no longer has a public profile", async () => {
    await remove(await sessionCookie(shelter.id));

    expect((await request(createApp()).get(`/api/shelters/${String(shelter.id)}`).set("Cookie", await sessionCookie(adopter.id))).status).toBe(404);
  });
});

describe("T-37 RN-210 audit log", () => {
  it("RN-210: the values in the details of the profile's entries are emptied (the keys stay) and its IP addresses are removed", async () => {
    await getPool().query(
      `INSERT INTO "Audit_log" (actor_user_id, action, entity_type, entity_id, details, ip_address) VALUES
         ($1, 'PROFILE_UPDATED', 'Adopter', $1, '{"before": {"phone": "600000000"}, "after": {"phone": "611111111"}}', '10.0.0.1'),
         ($1, 'LOGIN_FAILED', 'App_user', $1, '{}', '10.0.0.2'),
         ($2, 'PROFILE_UPDATED', 'Shelter', $2, '{"before": {"phone": "943000000"}, "after": {"phone": "943111111"}}', '10.0.0.3')`,
      [adopter.id, shelter.id],
    );

    await remove(await sessionCookie(adopter.id));

    const { rows } = await getPool().query(
      `SELECT actor_user_id, entity_type, details, host(ip_address) AS ip FROM "Audit_log" WHERE action IN ('PROFILE_UPDATED', 'LOGIN_FAILED') ORDER BY id`,
    );
    expect(rows).toEqual([
      { actor_user_id: adopter.id, entity_type: "Adopter", details: { before: { phone: null }, after: { phone: null } }, ip: null },
      { actor_user_id: adopter.id, entity_type: "App_user", details: {}, ip: null },
      // Another account's entries are untouched.
      { actor_user_id: shelter.id, entity_type: "Shelter", details: { before: { phone: "943000000" }, after: { phone: "943111111" } }, ip: "10.0.0.3" },
    ]);
  });
});
