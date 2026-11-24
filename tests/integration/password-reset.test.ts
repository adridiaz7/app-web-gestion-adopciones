import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { createEmailToken } from "../../src/server/services/email-tokens.js";
import { hashPassword } from "../../src/server/services/passwords.js";
import { truncateAll } from "../helpers/db.js";
import { captureEmails } from "../helpers/emails.js";
import { createAdopter, createShelter, type CreatedUser } from "../helpers/factories.js";

const FORGOT = "/api/auth/forgot-password";
const RESET = "/api/auth/reset-password";

const OLD_PASSWORD = "contraseña antigua";
const NEW_PASSWORD = "contraseña nueva";
const FORGOT_MESSAGE =
  "Si ese email tiene una cuenta, te hemos enviado un enlace para restablecer la contraseña. Revisa tu correo.";
const RESET_MESSAGE = "Tu contraseña se ha cambiado. Ya puedes iniciar sesión.";
const INVALID_LINK = "El enlace no es válido o ha caducado. Puedes pedir uno nuevo.";

let oldPasswordHash: string;

beforeAll(async () => {
  oldPasswordHash = await hashPassword(OLD_PASSWORD);
});

const forgot = (body: object) => request(createApp()).post(FORGOT).send(body);
const reset = (body: object) => request(createApp()).post(RESET).send(body);
const login = (email: string, password: string) =>
  request(createApp()).post("/api/auth/login").send({ email, password });

const HALF_HOUR = 1800;

async function resetTokens(userId: number): Promise<{ revoked: boolean; minutes: number }[]> {
  const { rows } = await getPool().query<{ revoked: boolean; minutes: number }>(
    `SELECT revoked_at IS NOT NULL AS revoked, round(extract(epoch FROM expires_at - created_at) / 60)::int AS minutes
       FROM "Email_token" WHERE user_id = $1 AND purpose = 'RESET_PASSWORD' ORDER BY id`,
    [userId],
  );
  return rows;
}

async function ageTokens(userId: number, interval: string): Promise<void> {
  await getPool().query(`UPDATE "Email_token" SET created_at = now() - $2::interval WHERE user_id = $1`, [
    userId,
    interval,
  ]);
}

describe("T-08 CU-05 POST /api/auth/forgot-password", () => {
  const printedEmails = captureEmails();
  let user: CreatedUser;

  beforeEach(async () => {
    await truncateAll();
    user = await createAdopter({ email: "ane@example.test", passwordHash: oldPasswordHash });
  });

  it("CU-05, RN-178: emails a reset link valid for 30 minutes", async () => {
    const res = await forgot({ email: " Ane@Example.test " });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: FORGOT_MESSAGE });
    expect(printedEmails()).toContain("ane@example.test");
    expect(printedEmails()).toMatch(/http:\/\/localhost:3000\/restablecer-contrasena\?token=[\w-]+/);
    expect(await resetTokens(user.id)).toEqual([{ revoked: false, minutes: 30 }]);
  });

  it("RN-181: the previous unused reset links stop working when a new one is created", async () => {
    await createEmailToken(getPool(), user.id, "RESET_PASSWORD", HALF_HOUR);
    await ageTokens(user.id, "6 minutes");

    await forgot({ email: user.email });

    expect((await resetTokens(user.id)).map((t) => t.revoked)).toEqual([true, false]);
  });

  it("RN-181: sends at most one reset link every 5 minutes per account, with the same answer", async () => {
    await forgot({ email: user.email });
    const res = await forgot({ email: user.email });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: FORGOT_MESSAGE });
    expect(printedEmails().match(/restablecer-contrasena\?token=/g)).toHaveLength(1);
  });

  it("RN-181: sends a new link once the 5 minutes have passed", async () => {
    await forgot({ email: user.email });
    await ageTokens(user.id, "5 minutes 1 second");
    await forgot({ email: user.email });

    expect(printedEmails().match(/restablecer-contrasena\?token=/g)).toHaveLength(2);
  });

  it("RN-181: the wait does not depend on verification links", async () => {
    await createEmailToken(getPool(), user.id, "VERIFY_EMAIL", 86400);

    await forgot({ email: user.email });

    expect(printedEmails()).toContain("restablecer-contrasena?token=");
  });

  it("RN-183: also sends the link to an unverified account", async () => {
    const unverified = await createShelter({ email: "sin-verificar@example.test", verified: false });

    await forgot({ email: unverified.email });

    expect(printedEmails()).toContain("restablecer-contrasena?token=");
  });

  it("CU-05: answers the same and sends nothing for an email without an account", async () => {
    const res = await forgot({ email: "nadie@example.test" });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: FORGOT_MESSAGE });
    expect(printedEmails()).toBe("");
  });

  it("CU-05, RN-183: answers the same and sends nothing for an account with an active suspension", async () => {
    await getPool().query(`INSERT INTO "Suspension" (user_id, reason) VALUES ($1, 'FRAUD')`, [user.id]);

    const res = await forgot({ email: user.email });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: FORGOT_MESSAGE });
    expect(printedEmails()).toBe("");
    expect(await resetTokens(user.id)).toEqual([]);
  });

  it("RN-183: answers the same and sends nothing for a deleted account", async () => {
    await getPool().query(`UPDATE "App_user" SET deleted_at = now() WHERE id = $1`, [user.id]);

    const res = await forgot({ email: user.email });

    expect(res.status).toBe(202);
    expect(printedEmails()).toBe("");
  });

  it("CU-05: rejects a malformed email", async () => {
    const res = await forgot({ email: "ane@" });

    expect(res.status).toBe(400);
    expect(res.body.fields).toMatchObject({ email: "El email no tiene un formato válido." });
  });
});

describe("T-08 CU-05 POST /api/auth/reset-password", () => {
  let user: CreatedUser;

  beforeEach(async () => {
    await truncateAll();
    user = await createAdopter({ email: "ane@example.test", passwordHash: oldPasswordHash });
  });

  it("CU-05: sets the new password, and the old one stops working", async () => {
    const token = await createEmailToken(getPool(), user.id, "RESET_PASSWORD", HALF_HOUR);

    const res = await reset({ token, password: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: RESET_MESSAGE });
    expect((await login(user.email, NEW_PASSWORD)).status).toBe(200);
    expect((await login(user.email, OLD_PASSWORD)).status).toBe(401);
  });

  it("RN-08: stores the new password as an Argon2id hash", async () => {
    const token = await createEmailToken(getPool(), user.id, "RESET_PASSWORD", HALF_HOUR);

    await reset({ token, password: NEW_PASSWORD });

    const { rows } = await getPool().query<{ password_hash: string }>(`SELECT password_hash FROM "App_user"`);
    expect(rows[0]?.password_hash).not.toBe(oldPasswordHash);
    expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
  });

  it("RN-178: a link can only be used once", async () => {
    const token = await createEmailToken(getPool(), user.id, "RESET_PASSWORD", HALF_HOUR);
    await reset({ token, password: NEW_PASSWORD });

    const res = await reset({ token, password: "tercera contraseña" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: INVALID_LINK });
    expect((await login(user.email, NEW_PASSWORD)).status).toBe(200);
  });

  it("RN-178: rejects an expired link", async () => {
    const token = await createEmailToken(getPool(), user.id, "RESET_PASSWORD", HALF_HOUR);
    await getPool().query(`UPDATE "Email_token" SET expires_at = now() - interval '1 second'`);

    const res = await reset({ token, password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: INVALID_LINK });
    expect((await login(user.email, OLD_PASSWORD)).status).toBe(200);
  });

  it("RN-181: rejects a link replaced by a newer one", async () => {
    const token = await createEmailToken(getPool(), user.id, "RESET_PASSWORD", HALF_HOUR);
    await getPool().query(`UPDATE "Email_token" SET revoked_at = now()`);

    expect((await reset({ token, password: NEW_PASSWORD })).body).toEqual({ error: INVALID_LINK });
  });

  it("CU-05: rejects an unknown link or one meant for another purpose", async () => {
    const verifyToken = await createEmailToken(getPool(), user.id, "VERIFY_EMAIL", 86400);

    expect((await reset({ token: "no-existe", password: NEW_PASSWORD })).body).toEqual({ error: INVALID_LINK });
    expect((await reset({ token: verifyToken, password: NEW_PASSWORD })).body).toEqual({ error: INVALID_LINK });
  });

  it("RN-183: rejects the link of an account deleted or suspended after it was sent", async () => {
    const token = await createEmailToken(getPool(), user.id, "RESET_PASSWORD", HALF_HOUR);
    await getPool().query(`INSERT INTO "Suspension" (user_id, reason) VALUES ($1, 'FRAUD')`, [user.id]);

    expect((await reset({ token, password: NEW_PASSWORD })).body).toEqual({ error: INVALID_LINK });

    const other = await createAdopter({ passwordHash: oldPasswordHash });
    const otherToken = await createEmailToken(getPool(), other.id, "RESET_PASSWORD", HALF_HOUR);
    await getPool().query(`UPDATE "App_user" SET deleted_at = now() WHERE id = $1`, [other.id]);

    expect((await reset({ token: otherToken, password: NEW_PASSWORD })).body).toEqual({ error: INVALID_LINK });
  });

  it("RN-183: setting the password with the link verifies the email", async () => {
    const unverified = await createAdopter({ passwordHash: oldPasswordHash, verified: false });
    const token = await createEmailToken(getPool(), unverified.id, "RESET_PASSWORD", HALF_HOUR);

    expect((await reset({ token, password: NEW_PASSWORD })).status).toBe(200);

    expect((await login(unverified.email, NEW_PASSWORD)).status).toBe(200);
  });

  it("RN-208: records the password reset in the audit log, without the password or its hash", async () => {
    const token = await createEmailToken(getPool(), user.id, "RESET_PASSWORD", HALF_HOUR);

    await reset({ token, password: NEW_PASSWORD });

    const { rows } = await getPool().query<{ actor_user_id: number; entity_id: number; ip: string | null }>(
      `SELECT actor_user_id, entity_id, host(ip_address) AS ip, details::text AS details
         FROM "Audit_log" WHERE action = 'PASSWORD_RESET'`,
    );
    expect(rows).toEqual([{ actor_user_id: user.id, entity_id: user.id, ip: expect.any(String), details: "{}" }]);
  });

  it("RN-175: rejects a new password shorter than 12 characters, keeping the link usable", async () => {
    const token = await createEmailToken(getPool(), user.id, "RESET_PASSWORD", HALF_HOUR);

    const res = await reset({ token, password: "once caract" });

    expect(res.status).toBe(400);
    expect(res.body.fields).toMatchObject({ password: "La contraseña debe tener al menos 12 caracteres." });
    expect((await reset({ token, password: NEW_PASSWORD })).status).toBe(200);
  });

  it("CU-05: rejects a request without token or password", async () => {
    const res = await request(createApp()).post(RESET);

    expect(res.status).toBe(400);
    expect(res.body.fields).toMatchObject({
      token: "Falta el enlace para restablecer la contraseña.",
      password: "Este campo es obligatorio.",
    });
  });
});
