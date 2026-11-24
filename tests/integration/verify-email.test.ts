import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { createEmailToken } from "../../src/server/services/email-tokens.js";
import { truncateAll } from "../helpers/db.js";
import { captureEmails } from "../helpers/emails.js";
import { createAdopter, createShelter } from "../helpers/factories.js";

const VERIFY = "/api/auth/verify-email";
const RESEND = "/api/auth/resend-verification";

const VERIFIED_MESSAGE = "Tu email está verificado. Ya puedes iniciar sesión.";
const INVALID_LINK = "El enlace no es válido o ha caducado. Puedes pedir uno nuevo.";
const ALREADY_VERIFIED = "Tu email ya estaba verificado. Puedes iniciar sesión.";
const RESEND_MESSAGE =
  "Si ese email tiene una cuenta pendiente de verificar, te hemos enviado un enlace nuevo. Revisa tu correo.";

const verify = (body: object) => request(createApp()).post(VERIFY).send(body);
const resend = (body: object) => request(createApp()).post(RESEND).send(body);

const DAY = 24 * 3600;

async function verifiedAt(userId: number): Promise<Date | null> {
  const { rows } = await getPool().query<{ email_verified_at: Date | null }>(
    `SELECT email_verified_at FROM "App_user" WHERE id = $1`,
    [userId],
  );
  return rows[0]?.email_verified_at ?? null;
}

describe("T-06 CU-03 POST /api/auth/verify-email", () => {
  beforeEach(truncateAll);

  it("RN-07: verifies the email of the account and uses up the link", async () => {
    const user = await createAdopter({ verified: false });
    const token = await createEmailToken(getPool(), user.id, "VERIFY_EMAIL", DAY);

    const res = await verify({ token });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: VERIFIED_MESSAGE });
    expect(await verifiedAt(user.id)).toBeInstanceOf(Date);
    const { rows } = await getPool().query<{ used_at: Date | null }>(`SELECT used_at FROM "Email_token"`);
    expect(rows[0]?.used_at).toBeInstanceOf(Date);
  });

  it("RN-07: also verifies a shelter account", async () => {
    const user = await createShelter({ verified: false, validationStatus: "PENDING" });
    const token = await createEmailToken(getPool(), user.id, "VERIFY_EMAIL", DAY);

    expect((await verify({ token })).status).toBe(200);
    expect(await verifiedAt(user.id)).toBeInstanceOf(Date);
  });

  it("CU-03: rejects a link that does not exist", async () => {
    const user = await createAdopter({ verified: false });

    const res = await verify({ token: "no-existe" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: INVALID_LINK });
    expect(await verifiedAt(user.id)).toBeNull();
  });

  it("RN-177: rejects an expired link", async () => {
    const user = await createAdopter({ verified: false });
    const token = await createEmailToken(getPool(), user.id, "VERIFY_EMAIL", DAY);
    await getPool().query(`UPDATE "Email_token" SET expires_at = now() - interval '1 second'`);

    const res = await verify({ token });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: INVALID_LINK });
    expect(await verifiedAt(user.id)).toBeNull();
  });

  it("RN-180: rejects a link replaced by a newer one", async () => {
    const user = await createAdopter({ verified: false });
    const token = await createEmailToken(getPool(), user.id, "VERIFY_EMAIL", DAY);
    await getPool().query(`UPDATE "Email_token" SET revoked_at = now()`);

    const res = await verify({ token });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: INVALID_LINK });
    expect(await verifiedAt(user.id)).toBeNull();
  });

  it("CU-03: rejects a link meant for another purpose", async () => {
    const user = await createAdopter({ verified: false });
    const token = await createEmailToken(getPool(), user.id, "RESET_PASSWORD", 1800);

    const res = await verify({ token });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: INVALID_LINK });
    expect(await verifiedAt(user.id)).toBeNull();
  });

  it("CU-03: rejects the link of a deleted account", async () => {
    const user = await createAdopter({ verified: false });
    const token = await createEmailToken(getPool(), user.id, "VERIFY_EMAIL", DAY);
    await getPool().query(`UPDATE "App_user" SET deleted_at = now() WHERE id = $1`, [user.id]);

    const res = await verify({ token });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: INVALID_LINK });
    expect(await verifiedAt(user.id)).toBeNull();
  });

  it("CU-03: tells the user when the email was already verified, even if the link was already used", async () => {
    const user = await createAdopter({ verified: false });
    const token = await createEmailToken(getPool(), user.id, "VERIFY_EMAIL", DAY);
    await verify({ token });

    const res = await verify({ token });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: ALREADY_VERIFIED });
  });

  it("CU-03: rejects a request without a token", async () => {
    const res = await request(createApp()).post(VERIFY);

    expect(res.status).toBe(400);
    expect(res.body.fields).toMatchObject({ token: "Falta el enlace de verificación." });
  });
});

describe("T-06 CU-03 POST /api/auth/resend-verification", () => {
  const printedEmails = captureEmails();

  beforeEach(truncateAll);

  async function tokens(userId: number): Promise<{ revoked: boolean }[]> {
    const { rows } = await getPool().query<{ revoked: boolean }>(
      `SELECT revoked_at IS NOT NULL AS revoked FROM "Email_token" WHERE user_id = $1 ORDER BY id`,
      [userId],
    );
    return rows;
  }

  /** Makes the account's existing links look created `minutes` ago. */
  async function ageTokens(userId: number, minutes: number): Promise<void> {
    await getPool().query(
      `UPDATE "Email_token" SET created_at = now() - make_interval(mins => $2) WHERE user_id = $1`,
      [userId, minutes],
    );
  }

  it("CU-03: emails a new verification link that works", async () => {
    const user = await createAdopter({ email: "ane@example.test", verified: false });

    const res = await resend({ email: " Ane@Example.test " });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: RESEND_MESSAGE });
    const match = /\/verificar-email\?token=([\w-]+)/.exec(printedEmails());
    expect(printedEmails()).toContain("ane@example.test");
    expect((await verify({ token: match?.[1] ?? "" })).status).toBe(200);
    expect(await verifiedAt(user.id)).toBeInstanceOf(Date);
  });

  it("RN-180: the previous unused links stop working when a new one is created", async () => {
    const user = await createAdopter({ verified: false });
    const oldToken = await createEmailToken(getPool(), user.id, "VERIFY_EMAIL", DAY);
    await ageTokens(user.id, 6);

    await resend({ email: user.email });

    expect(await tokens(user.id)).toEqual([{ revoked: true }, { revoked: false }]);
    expect((await verify({ token: oldToken })).body).toEqual({ error: INVALID_LINK });
  });

  it("RN-180: sends at most one link every 5 minutes per account, with the same answer", async () => {
    const user = await createAdopter({ verified: false });
    await createEmailToken(getPool(), user.id, "VERIFY_EMAIL", DAY);
    await ageTokens(user.id, 4);

    const res = await resend({ email: user.email });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: RESEND_MESSAGE });
    expect(printedEmails()).toBe("");
    expect(await tokens(user.id)).toEqual([{ revoked: false }]);
  });

  it("RN-180: sends a new link once the 5 minutes have passed", async () => {
    const user = await createAdopter({ verified: false });
    await createEmailToken(getPool(), user.id, "VERIFY_EMAIL", DAY);
    await getPool().query(`UPDATE "Email_token" SET created_at = now() - interval '5 minutes 1 second'`);

    await resend({ email: user.email });

    expect(printedEmails()).toContain("/verificar-email?token=");
  });

  it("RN-180: the wait does not depend on other kinds of links", async () => {
    const user = await createAdopter({ verified: false });
    await createEmailToken(getPool(), user.id, "RESET_PASSWORD", 1800);

    await resend({ email: user.email });

    expect(printedEmails()).toContain("/verificar-email?token=");
  });

  it("CU-03: answers the same and sends nothing for an email without an account", async () => {
    const res = await resend({ email: "nadie@example.test" });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: RESEND_MESSAGE });
    expect(printedEmails()).toBe("");
  });

  it("CU-03: answers the same and sends nothing for an account already verified", async () => {
    const user = await createAdopter({ verified: true });

    const res = await resend({ email: user.email });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: RESEND_MESSAGE });
    expect(printedEmails()).toBe("");
    expect(await tokens(user.id)).toEqual([]);
  });

  it("CU-03: answers the same and sends nothing for a deleted account", async () => {
    const user = await createAdopter({ verified: false });
    await getPool().query(`UPDATE "App_user" SET deleted_at = now() WHERE id = $1`, [user.id]);

    const res = await resend({ email: user.email });

    expect(res.status).toBe(202);
    expect(printedEmails()).toBe("");
  });

  it("CU-03: rejects a malformed email", async () => {
    const res = await resend({ email: "ane@" });

    expect(res.status).toBe(400);
    expect(res.body.fields).toMatchObject({ email: "El email no tiene un formato válido." });
  });
});
