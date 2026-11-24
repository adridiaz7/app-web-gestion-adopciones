import { createHash } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { truncateAll } from "../helpers/db.js";
import { captureEmails } from "../helpers/emails.js";
import { createShelter } from "../helpers/factories.js";

const ENDPOINT = "/api/auth/register/adopter";

const validBody = {
  email: "Ane.Etxeberria@Example.test",
  password: "doce caracteres",
  firstName: "Ane",
  lastName: "Etxeberria",
  phone: "600 123 456",
  birthDate: "1995-04-12",
  provinceId: 20,
  locality: "Donostia",
  acceptTerms: true,
};

const REGISTERED_MESSAGE = "Te hemos enviado un email con un enlace para verificar tu cuenta.";

const register = (body: object) => request(createApp()).post(ENDPOINT).send(body);

async function countRows(table: "App_user" | "Adopter" | "Email_token"): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`);
  return rows[0]?.n ?? 0;
}

describe("T-04 CU-01 POST /api/auth/register/adopter", () => {
  const printedEmails = captureEmails();

  beforeEach(truncateAll);

  it("CU-01: creates an unverified adopter account with its personal data", async () => {
    const res = await register(validBody);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: REGISTERED_MESSAGE });

    const { rows: users } = await getPool().query(
      `SELECT id, email, password_hash, role, email_verified_at, terms_accepted_at FROM "App_user"`,
    );
    expect(users).toHaveLength(1);
    const user = users[0];
    expect(user).toMatchObject({ email: "ane.etxeberria@example.test", role: "ADOPTER", email_verified_at: null });
    expect(user.terms_accepted_at).toBeInstanceOf(Date);

    const { rows: adopters } = await getPool().query(
      `SELECT user_id, first_name, last_name, phone, to_char(birth_date, 'YYYY-MM-DD') AS birth_date,
              province_id, locality, housing_type
         FROM "Adopter"`,
    );
    expect(adopters).toEqual([
      {
        user_id: user.id,
        first_name: "Ane",
        last_name: "Etxeberria",
        phone: "600123456",
        birth_date: "1995-04-12",
        province_id: 20,
        locality: "Donostia",
        housing_type: null,
      },
    ]);
  });

  it("RN-08: stores the password as an Argon2id hash", async () => {
    await register(validBody);

    const { rows } = await getPool().query<{ password_hash: string }>(`SELECT password_hash FROM "App_user"`);
    expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0]?.password_hash).not.toContain(validBody.password);
  });

  it("RN-186: stores the date the terms were accepted", async () => {
    const before = Date.now();
    await register(validBody);

    const { rows } = await getPool().query<{ terms_accepted_at: Date }>(`SELECT terms_accepted_at FROM "App_user"`);
    expect(rows[0]?.terms_accepted_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("RN-07, RN-177: emails a verification link valid for 24 h and stores only the hash of its token", async () => {
    await register(validBody);

    const match = /\/verificar-email\?token=([\w-]+)/.exec(printedEmails());
    expect(match).not.toBeNull();
    const token = match?.[1] ?? "";
    expect(printedEmails()).toContain("ane.etxeberria@example.test");
    expect(printedEmails()).toContain(`http://localhost:3000/verificar-email?token=${token}`);

    const { rows } = await getPool().query<{ purpose: string; token_hash: string; hours: number; used_at: Date | null }>(
      `SELECT purpose, token_hash, used_at,
              round(extract(epoch FROM expires_at - created_at) / 3600)::int AS hours
         FROM "Email_token"`,
    );
    expect(rows).toEqual([
      {
        purpose: "VERIFY_EMAIL",
        token_hash: createHash("sha256").update(token).digest("hex"),
        used_at: null,
        hours: 24,
      },
    ]);
  });

  it("RN-186: rejects the sign-up when the terms and privacy policy are not accepted", async () => {
    const res = await register({ ...validBody, acceptTerms: false });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Tienes que aceptar los términos de uso y la política de privacidad." });
    expect(await countRows("App_user")).toBe(0);
    expect(printedEmails()).toBe("");
  });

  it("RN-25: rejects a minor", async () => {
    const madridToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
    const [year, month, day] = madridToday.split("-") as [string, string, string];
    // Turns 18 tomorrow (or on 1 March, if today is 28 February).
    const birthDate = new Date(Date.UTC(Number(year) - 18, Number(month) - 1, Number(day) + 1)).toISOString().slice(0, 10);

    const res = await register({ ...validBody, birthDate });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Tienes que ser mayor de edad para registrarte." });
    expect(await countRows("App_user")).toBe(0);
    expect(printedEmails()).toBe("");
  });

  it("CU-01: rejects a province that does not exist", async () => {
    const res = await register({ ...validBody, provinceId: 99 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "La provincia no existe." });
    expect(await countRows("App_user")).toBe(0);
  });

  it("RN-06: an email is unique regardless of case", async () => {
    await register(validBody);
    await register({ ...validBody, email: "ANE.ETXEBERRIA@EXAMPLE.TEST" });

    expect(await countRows("App_user")).toBe(1);
    expect(await countRows("Adopter")).toBe(1);
  });
});

describe("T-04 CU-01 POST /api/auth/register/adopter with missing or malformed data", () => {
  const printedEmails = captureEmails();

  beforeEach(truncateAll);

  async function expectInvalid(body: object, field: string, message: string): Promise<void> {
    const res = await register(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Los datos enviados no son válidos.");
    expect(res.body.fields).toMatchObject({ [field]: message });
    expect(await countRows("App_user")).toBe(0);
    expect(printedEmails()).toBe("");
  }

  it("CU-01: rejects missing mandatory data, field by field", async () => {
    const res = await register({});

    expect(res.status).toBe(400);
    const required = "Este campo es obligatorio.";
    expect(res.body.fields).toMatchObject({
      email: required,
      password: required,
      firstName: required,
      lastName: required,
      phone: required,
      locality: required,
      acceptTerms: required,
      birthDate: "La fecha de nacimiento no es válida.",
      provinceId: "Elige una provincia.",
    });
    expect(await countRows("App_user")).toBe(0);
  });

  it("CU-01: rejects names and locality made only of spaces", async () => {
    await expectInvalid({ ...validBody, firstName: "   " }, "firstName", "Este campo es obligatorio.");
    await expectInvalid({ ...validBody, locality: " " }, "locality", "Este campo es obligatorio.");
  });

  it("CU-01: rejects a malformed email", async () => {
    await expectInvalid({ ...validBody, email: "ane@" }, "email", "El email no tiene un formato válido.");
  });

  it("CU-01: rejects a malformed phone number", async () => {
    await expectInvalid({ ...validBody, phone: "12345" }, "phone", "El teléfono no tiene un formato válido.");
  });

  it("CU-01: accepts a Spanish phone number with the +34 prefix", async () => {
    const res = await register({ ...validBody, phone: "+34 943 123 456" });

    expect(res.status).toBe(202);
    const { rows } = await getPool().query<{ phone: string }>(`SELECT phone FROM "Adopter"`);
    expect(rows[0]?.phone).toBe("+34943123456");
  });

  it("CU-01: rejects a birth date that does not exist", async () => {
    await expectInvalid({ ...validBody, birthDate: "1995-02-30" }, "birthDate", "La fecha de nacimiento no es válida.");
  });

  it("RN-175: rejects a password shorter than 12 characters", async () => {
    await expectInvalid(
      { ...validBody, password: "once caract" },
      "password",
      "La contraseña debe tener al menos 12 caracteres.",
    );
  });

  it("RN-175: rejects a password longer than 256 characters", async () => {
    await expectInvalid(
      { ...validBody, password: "a".repeat(257) },
      "password",
      "La contraseña no puede tener más de 256 caracteres.",
    );
  });

  it("RN-175: accepts 12 and 256 characters, with no composition rules", async () => {
    expect((await register({ ...validBody, password: "aaaaaaaaaaaa" })).status).toBe(202);
    expect((await register({ ...validBody, email: "otra@example.test", password: "a".repeat(256) })).status).toBe(202);
    expect(await countRows("Adopter")).toBe(2);
  });
});

describe("T-04 CU-01 POST /api/auth/register/adopter with an email that already has an account", () => {
  const printedEmails = captureEmails();
  const existingEmail = "ane.etxeberria@example.test";
  let ownerId: number;

  beforeEach(async () => {
    await truncateAll();
    ownerId = (await createShelter({ email: existingEmail })).id;
  });

  async function noticeSentAt(): Promise<Date | null> {
    const { rows } = await getPool().query<{ existing_account_notice_at: Date | null }>(
      `SELECT existing_account_notice_at FROM "App_user" WHERE id = $1`,
      [ownerId],
    );
    return rows[0]?.existing_account_notice_at ?? null;
  }

  it("RN-182: answers exactly as with a new email and creates nothing", async () => {
    const res = await register(validBody);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: REGISTERED_MESSAGE });
    expect(await countRows("App_user")).toBe(1);
    expect(await countRows("Adopter")).toBe(0);
    expect(await countRows("Email_token")).toBe(0);
  });

  it("RN-182: emails the owner a notice with the link to recover the password, and no verification link", async () => {
    await register(validBody);

    const printed = printedEmails();
    expect(printed).toContain(existingEmail);
    expect(printed).toContain("Alguien ha intentado registrarse con tu email");
    expect(printed).toContain("http://localhost:3000/recuperar-contrasena");
    expect(printed).not.toContain("/verificar-email");
    expect(await noticeSentAt()).toBeInstanceOf(Date);
  });

  it("RN-182: sends at most one notice every 5 minutes per account", async () => {
    await register(validBody);
    await register(validBody);

    expect(printedEmails().match(/Asunto: Alguien ha intentado registrarse con tu email/g)).toHaveLength(1);
  });

  it("RN-182: sends a new notice once the 5 minutes have passed", async () => {
    await register(validBody);
    await getPool().query(
      `UPDATE "App_user" SET existing_account_notice_at = now() - interval '5 minutes 1 second' WHERE id = $1`,
      [ownerId],
    );
    await register(validBody);

    expect(printedEmails().match(/Asunto: Alguien ha intentado registrarse con tu email/g)).toHaveLength(2);
  });

  it("RN-182: does not notify an account with an active suspension", async () => {
    await getPool().query(`INSERT INTO "Suspension" (user_id, reason) VALUES ($1, 'FRAUD')`, [ownerId]);

    const res = await register(validBody);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: REGISTERED_MESSAGE });
    expect(printedEmails()).toBe("");
    expect(await noticeSentAt()).toBeNull();
  });

  it("RN-182: notifies an account whose suspension has ended", async () => {
    await getPool().query(
      `INSERT INTO "Suspension" (user_id, reason, started_at, ended_at)
       VALUES ($1, 'FRAUD', now() - interval '2 days', now() - interval '1 day')`,
      [ownerId],
    );

    await register(validBody);

    expect(printedEmails()).toContain("Alguien ha intentado registrarse con tu email");
  });

  it("RN-182: does not notify a deleted account", async () => {
    await getPool().query(`UPDATE "App_user" SET deleted_at = now() WHERE id = $1`, [ownerId]);

    const res = await register(validBody);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: REGISTERED_MESSAGE });
    expect(printedEmails()).toBe("");
    expect(await noticeSentAt()).toBeNull();
  });
});
