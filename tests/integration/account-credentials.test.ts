import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { hashPassword, verifyPassword } from "../../src/server/services/passwords.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { captureEmails } from "../helpers/emails.js";
import { createAdmin, createAdopter, createShelter, type CreatedUser } from "../helpers/factories.js";

const PASSWORD = "contraseña actual";
const NEW_PASSWORD = "contraseña nueva y larga";
const INVALID_LINK = "El enlace no es válido o ha caducado. Puedes pedir uno nuevo.";
const EMAIL_SENT = "Te hemos enviado un enlace al email nuevo. El cambio se hará cuando lo abras.";

let passwordHash: string;
let adopter: CreatedUser;
let cookie: string;

const post = (path: string, body: object, as: string | null = cookie) => {
  const req = request(createApp()).post(path);
  return (as === null ? req : req.set("Cookie", as)).send(body);
};
const changePassword = (body: object, as: string | null = cookie) => post("/api/auth/change-password", body, as);
const changeEmail = (body: object, as: string | null = cookie) => post("/api/auth/change-email", body, as);
const confirmEmail = (token: string) => post("/api/auth/confirm-email-change", { token }, null);

async function user(id: number): Promise<{ email: string; password_hash: string }> {
  const { rows } = await getPool().query<{ email: string; password_hash: string }>(`SELECT email, password_hash FROM "App_user" WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) throw new Error("no user");
  return row;
}

const auditActions = async (): Promise<{ action: string; actor_user_id: number; entity_id: number }[]> =>
  (await getPool().query<{ action: string; actor_user_id: number; entity_id: number }>(`SELECT action, actor_user_id, entity_id FROM "Audit_log" ORDER BY id`)).rows;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await truncateAll();
  adopter = await createAdopter({ email: "ane@example.test", passwordHash });
  cookie = await sessionCookie(adopter.id);
});

describe("T-43 CU-49 POST /api/auth/change-password", () => {
  it("CU-49, RN-08, RN-208: changes the password with the current one and audits it", async () => {
    const res = await changePassword({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(204);
    const { password_hash } = await user(adopter.id);
    expect(await verifyPassword(password_hash, NEW_PASSWORD)).toBe(true);
    expect(await verifyPassword(password_hash, PASSWORD)).toBe(false);
    expect(await auditActions()).toEqual([{ action: "PASSWORD_CHANGED", actor_user_id: adopter.id, entity_id: adopter.id }]);
  });

  it("CU-49: rejects a wrong current password and changes nothing", async () => {
    const res = await changePassword({ currentPassword: "otra contraseña", newPassword: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "La contraseña actual no es correcta." });
    expect(await verifyPassword((await user(adopter.id)).password_hash, PASSWORD)).toBe(true);
    expect(await auditActions()).toEqual([]);
  });

  it("CU-49, RN-175: rejects a new password that is too short or too long", async () => {
    expect((await changePassword({ currentPassword: PASSWORD, newPassword: "corta" })).status).toBe(400);
    expect((await changePassword({ currentPassword: PASSWORD, newPassword: "x".repeat(257) })).status).toBe(400);
    expect(await verifyPassword((await user(adopter.id)).password_hash, PASSWORD)).toBe(true);
  });

  it("CU-49: a shelter can change its password too", async () => {
    const shelter = await createShelter({ passwordHash });

    expect((await changePassword({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, await sessionCookie(shelter.id))).status).toBe(204);
  });

  it("CU-49: a session is required, and the administrator is not an actor", async () => {
    expect((await changePassword({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, null)).status).toBe(401);
    const admin = await createAdmin({ passwordHash });
    expect((await changePassword({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, await sessionCookie(admin.id))).status).toBe(403);
    expect(await verifyPassword((await user(admin.id)).password_hash, PASSWORD)).toBe(true);
  });
});

describe("T-43 CU-49 change the email", () => {
  const printedEmails = captureEmails();

  const linkToken = (): string => {
    const match = /\/confirmar-email\?token=([\w-]+)/.exec(printedEmails());
    if (!match?.[1]) throw new Error("no link");
    return match[1];
  };

  it("CU-49, RN-177: sends a link to the new email; the email only changes when it is opened", async () => {
    const res = await changeEmail({ newEmail: " Nueva@Example.test " });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: EMAIL_SENT });
    expect(printedEmails()).toContain("Para: nueva@example.test");
    expect((await user(adopter.id)).email).toBe("ane@example.test");
    const { rows } = await getPool().query<{ new_email: string; hours: number }>(
      `SELECT new_email, round(extract(epoch FROM expires_at - created_at) / 3600)::int AS hours FROM "Email_token" WHERE purpose = 'CHANGE_EMAIL'`,
    );
    expect(rows).toEqual([{ new_email: "nueva@example.test", hours: 24 }]);
  });

  it("CU-49, RN-208: opening the link changes the email, tells the old address and audits it", async () => {
    await changeEmail({ newEmail: "nueva@example.test" });
    const token = linkToken();

    const res = await confirmEmail(token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Tu email se ha cambiado. A partir de ahora inicia sesión con nueva@example.test." });
    expect((await user(adopter.id)).email).toBe("nueva@example.test");
    expect(printedEmails()).toMatch(/Para: ane@example\.test\s+Asunto: Tu email ha cambiado/);
    expect(await auditActions()).toEqual([{ action: "EMAIL_CHANGED", actor_user_id: adopter.id, entity_id: adopter.id }]);
    // The new email logs in.
    const login = await request(createApp()).post("/api/auth/login").send({ email: "nueva@example.test", password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it("CU-49: an email already registered gets the same answer, and no link is sent", async () => {
    await createShelter({ email: "ocupado@example.test" });

    const res = await changeEmail({ newEmail: "ocupado@example.test" });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: EMAIL_SENT });
    expect(printedEmails()).not.toContain("confirmar-email");
    const { rows } = await getPool().query(`SELECT 1 FROM "Email_token" WHERE purpose = 'CHANGE_EMAIL'`);
    expect(rows).toEqual([]);
  });

  it("CU-49: rejects an email with an invalid format", async () => {
    const res = await changeEmail({ newEmail: "no-es-un-email" });

    expect(res.status).toBe(400);
    expect(printedEmails()).toBe("");
  });

  it("CU-49: an unknown, used or expired link is not valid", async () => {
    expect((await confirmEmail("no-existe")).body).toEqual({ error: INVALID_LINK });

    await changeEmail({ newEmail: "nueva@example.test" });
    const token = linkToken();
    await getPool().query(`UPDATE "Email_token" SET expires_at = now() - interval '1 second' WHERE purpose = 'CHANGE_EMAIL'`);
    const expired = await confirmEmail(token);
    expect(expired.status).toBe(400);
    expect(expired.body).toEqual({ error: INVALID_LINK });
    expect((await user(adopter.id)).email).toBe("ane@example.test");

    await getPool().query(`UPDATE "Email_token" SET expires_at = now() + interval '1 hour' WHERE purpose = 'CHANGE_EMAIL'`);
    expect((await confirmEmail(token)).status).toBe(200);
    const used = await confirmEmail(token);
    expect(used.status).toBe(400);
    expect(used.body).toEqual({ error: INVALID_LINK });
  });

  it("CU-49: a new request voids the earlier unused link", async () => {
    await changeEmail({ newEmail: "primera@example.test" });
    const first = linkToken();
    await changeEmail({ newEmail: "segunda@example.test" });

    expect((await confirmEmail(first)).body).toEqual({ error: INVALID_LINK });
    expect((await user(adopter.id)).email).toBe("ane@example.test");
  });

  it("CU-49: the link is not valid if the new email was registered in the meantime", async () => {
    await changeEmail({ newEmail: "nueva@example.test" });
    const token = linkToken();
    await createAdopter({ email: "nueva@example.test" });

    const res = await confirmEmail(token);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: INVALID_LINK });
    expect((await user(adopter.id)).email).toBe("ane@example.test");
  });

  it("CU-49: a session is required, and the administrator is not an actor", async () => {
    expect((await changeEmail({ newEmail: "nueva@example.test" }, null)).status).toBe(401);
    const admin = await createAdmin();
    expect((await changeEmail({ newEmail: "nueva@example.test" }, await sessionCookie(admin.id))).status).toBe(403);
    expect(printedEmails()).toBe("");
  });
});
