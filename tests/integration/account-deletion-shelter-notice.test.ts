import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { hashPassword } from "../../src/server/services/passwords.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = "contraseña-de-prueba";
let passwordHash: string;

let adopter: CreatedUser;

interface NotificationRow {
  user_id: number;
  type: string;
  title: string;
  body: string;
  visit_id: number | null;
  adoption_id: number | null;
}

const removeAccount = async (userId: number) =>
  request(createApp()).post("/api/auth/delete-account").set("Cookie", await sessionCookie(userId)).send({ password: PASSWORD });

async function visit(shelterId: number, petId: number, status: "PENDING" | "CONFIRMED", days = 5): Promise<number> {
  const slot = await createVisitSlot({ shelterId, startsAt: new Date(Date.now() + days * DAY) });
  return (await createVisit({ adopterId: adopter.id, shelterId, petId, slotId: slot.id, status })).id;
}

/** An adoption by the adopter, enabled by a completed visit; an APPROVED one reserves the pet. */
async function adoption(shelterId: number, petId: number, status: "PENDING" | "APPROVED" | "COMPLETED"): Promise<number> {
  const slot = await createVisitSlot({ shelterId, startsAt: new Date(Date.now() - 3 * DAY) });
  const v = await createVisit({ adopterId: adopter.id, shelterId, petId, slotId: slot.id, status: "CONFIRMED" });
  await getPool().query(`UPDATE "Visit" SET status = 'COMPLETED', attendance_marked_by = 'SYSTEM', attendance_marked_at = now() WHERE id = $1`, [v.id]);
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO "Adoption" (adopter_id, pet_id, visit_id, questionnaire_answers, status, decided_at, delivered_at)
     VALUES ($1, $2, $3, '{}', $4, CASE WHEN $4 <> 'PENDING' THEN now() END, CASE WHEN $4 = 'COMPLETED' THEN now() END) RETURNING id`,
    [adopter.id, petId, v.id, status],
  );
  if (status === "APPROVED") await getPool().query(`UPDATE "Pet" SET status = 'RESERVED' WHERE id = $1`, [petId]);
  if (status === "COMPLETED") await getPool().query(`UPDATE "Pet" SET status = 'ADOPTED' WHERE id = $1`, [petId]);
  return rows[0]?.id ?? 0;
}

const notificationsOf = async (userId: number): Promise<NotificationRow[]> =>
  (
    await getPool().query<NotificationRow>(
      `SELECT user_id::int, type, title, body, visit_id::int, adoption_id::int FROM "Notification" WHERE user_id = $1 ORDER BY id`,
      [userId],
    )
  ).rows;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await truncateAll();
  adopter = await createAdopter({ firstName: "Ane", lastName: "Etxeberria", email: "ane@example.com", passwordHash });
});

describe("T-53 CU-07 RN-12: the shelter is told when an adopter deletes their account", () => {
  it("RN-12, RN-140: each shelter gets one notification per open visit voided, linked to it", async () => {
    const huellas = await createShelter({ name: "Huellas" });
    const refugio = await createShelter({ name: "Refugio" });
    const luna = await createPet({ shelterId: huellas.id, name: "Luna" });
    const toby = await createPet({ shelterId: refugio.id, name: "Toby" });
    const pending = await visit(huellas.id, luna.id, "PENDING");
    const confirmed = await visit(refugio.id, toby.id, "CONFIRMED");

    expect((await removeAccount(adopter.id)).status).toBe(204);

    const forHuellas = await notificationsOf(huellas.id);
    const forRefugio = await notificationsOf(refugio.id);
    expect(forHuellas).toEqual([expect.objectContaining({ type: "VISIT_VOIDED_ADOPTER_DELETED", visit_id: pending, adoption_id: null })]);
    expect(forRefugio).toEqual([expect.objectContaining({ type: "VISIT_VOIDED_ADOPTER_DELETED", visit_id: confirmed, adoption_id: null })]);
    expect(forHuellas[0]?.body).toContain("Luna");
    expect(forRefugio[0]?.body).toContain("Toby");
  });

  it("RN-12, RN-140: each pending or approved adoption voided is told to its shelter, linked to it", async () => {
    const shelter = await createShelter({ name: "Huellas" });
    const luna = await createPet({ shelterId: shelter.id, name: "Luna" });
    const toby = await createPet({ shelterId: shelter.id, name: "Toby" });
    const pending = await adoption(shelter.id, luna.id, "PENDING");
    const approved = await adoption(shelter.id, toby.id, "APPROVED");

    expect((await removeAccount(adopter.id)).status).toBe(204);

    expect(await notificationsOf(shelter.id)).toEqual([
      expect.objectContaining({ type: "ADOPTION_VOIDED_ADOPTER_DELETED", adoption_id: pending, visit_id: null, body: expect.stringContaining("Luna") }),
      expect.objectContaining({ type: "ADOPTION_VOIDED_ADOPTER_DELETED", adoption_id: approved, visit_id: null, body: expect.stringContaining("Toby") }),
    ]);
  });

  it("RN-210: the notice speaks of 'Usuario eliminado', with no personal data of the adopter", async () => {
    const shelter = await createShelter({ name: "Huellas" });
    const luna = await createPet({ shelterId: shelter.id, name: "Luna" });
    await visit(shelter.id, luna.id, "PENDING");
    await adoption(shelter.id, (await createPet({ shelterId: shelter.id, name: "Toby" })).id, "PENDING");

    expect((await removeAccount(adopter.id)).status).toBe(204);

    const rows = await notificationsOf(shelter.id);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.body).toContain("Usuario eliminado");
      expect(`${row.title} ${row.body}`).not.toMatch(/Ane|Etxeberria|ane@example\.com/);
    }
  });

  it("RN-12: shelters with only closed processes with the adopter get no notice", async () => {
    const shelter = await createShelter({ name: "Huellas" });
    // the completed adoption comes with its COMPLETED visit: both are closed
    await adoption(shelter.id, (await createPet({ shelterId: shelter.id, name: "Toby" })).id, "COMPLETED");

    expect((await removeAccount(adopter.id)).status).toBe(204);

    expect(await notificationsOf(shelter.id)).toEqual([]);
  });

  it("RN-171: if the deletion fails, no notice is sent to the shelter", async () => {
    const shelter = await createShelter({ name: "Huellas" });
    await visit(shelter.id, (await createPet({ shelterId: shelter.id, name: "Luna" })).id, "PENDING");

    const res = await request(createApp())
      .post("/api/auth/delete-account")
      .set("Cookie", await sessionCookie(adopter.id))
      .send({ password: "otra-contraseña" });

    expect(res.status).toBe(400);
    expect(await notificationsOf(shelter.id)).toEqual([]);
  });
});
