import { createHash } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { truncateAll } from "../helpers/db.js";
import { captureEmails } from "../helpers/emails.js";
import { createAdopter, createShelter } from "../helpers/factories.js";

const ENDPOINT = "/api/auth/register/shelter";

const validBody = {
  email: "Info@Protectora-Txiki.test",
  password: "doce caracteres",
  name: "Protectora Txiki",
  cif: "G12345678",
  address: "Calle del Puerto 3",
  provinceId: 20,
  locality: "Donostia",
  phone: "943 123 456",
  acceptTerms: true,
};

const REGISTERED_MESSAGE = "Te hemos enviado un email con un enlace para verificar tu cuenta.";
const CIF_TAKEN_MESSAGE = "Ya hay una protectora registrada con ese CIF.";

const register = (body: object) => request(createApp()).post(ENDPOINT).send(body);

async function countRows(table: "App_user" | "Shelter" | "Email_token"): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`);
  return rows[0]?.n ?? 0;
}

describe("T-05 CU-02 POST /api/auth/register/shelter", () => {
  const printedEmails = captureEmails();

  beforeEach(truncateAll);

  it("CU-02, RN-14: creates an unverified shelter account pending validation, with its data", async () => {
    const res = await register(validBody);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: REGISTERED_MESSAGE });

    const { rows: users } = await getPool().query(
      `SELECT id, email, password_hash, role, email_verified_at, terms_accepted_at FROM "App_user"`,
    );
    expect(users).toHaveLength(1);
    const user = users[0];
    expect(user).toMatchObject({ email: "info@protectora-txiki.test", role: "SHELTER", email_verified_at: null });
    expect(user.password_hash).toMatch(/^\$argon2id\$/);
    expect(user.terms_accepted_at).toBeInstanceOf(Date);

    const { rows: shelters } = await getPool().query(
      `SELECT user_id, name, cif, address, province_id, locality, phone, validation_status, validated_at
         FROM "Shelter"`,
    );
    expect(shelters).toEqual([
      {
        user_id: user.id,
        name: "Protectora Txiki",
        cif: "G12345678",
        address: "Calle del Puerto 3",
        province_id: 20,
        locality: "Donostia",
        phone: "943123456",
        validation_status: "PENDING",
        validated_at: null,
      },
    ]);
  });

  it("CU-02, RN-177: emails a verification link valid for 24 h and stores only the hash of its token", async () => {
    await register(validBody);

    const match = /\/verificar-email\?token=([\w-]+)/.exec(printedEmails());
    expect(match).not.toBeNull();
    const token = match?.[1] ?? "";
    expect(printedEmails()).toContain("info@protectora-txiki.test");

    const { rows } = await getPool().query<{ purpose: string; token_hash: string; hours: number }>(
      `SELECT purpose, token_hash, round(extract(epoch FROM expires_at - created_at) / 3600)::int AS hours
         FROM "Email_token"`,
    );
    expect(rows).toEqual([
      { purpose: "VERIFY_EMAIL", token_hash: createHash("sha256").update(token).digest("hex"), hours: 24 },
    ]);
  });

  it("CU-02: stores the CIF upper-cased, without spaces or hyphens", async () => {
    const res = await register({ ...validBody, cif: " g-1234567 8 " });

    expect(res.status).toBe(202);
    const { rows } = await getPool().query<{ cif: string }>(`SELECT cif FROM "Shelter"`);
    expect(rows[0]?.cif).toBe("G12345678");
  });

  it("RN-186: rejects the sign-up when the terms and privacy policy are not accepted", async () => {
    const res = await register({ ...validBody, acceptTerms: false });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Tienes que aceptar los términos de uso y la política de privacidad." });
    expect(await countRows("App_user")).toBe(0);
    expect(printedEmails()).toBe("");
  });

  it("CU-02: rejects a province that does not exist", async () => {
    const res = await register({ ...validBody, provinceId: 99 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "La provincia no existe." });
    expect(await countRows("App_user")).toBe(0);
  });
});

describe("T-05 CU-02 POST /api/auth/register/shelter with a CIF already registered", () => {
  const printedEmails = captureEmails();

  beforeEach(truncateAll);

  it("RN-17: rejects a CIF already registered by another shelter and creates nothing", async () => {
    await createShelter({ cif: "G12345678" });

    const res = await register(validBody);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: CIF_TAKEN_MESSAGE });
    expect(await countRows("App_user")).toBe(1);
    expect(await countRows("Shelter")).toBe(1);
    expect(await countRows("Email_token")).toBe(0);
    expect(printedEmails()).toBe("");
  });

  it("RN-17: the CIF is compared after normalising its format", async () => {
    await register(validBody);

    const res = await register({ ...validBody, email: "otra@example.test", cif: "g-12345678" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: CIF_TAKEN_MESSAGE });
    expect(await countRows("Shelter")).toBe(1);
  });

  it("RN-17: rejects the CIF when another sign-up takes it while this one is in progress", async () => {
    // Another sign-up holds the CIF in a transaction not yet committed, so the first check does not see it.
    const other = await getPool().connect();
    try {
      await other.query("BEGIN");
      const { rows } = await other.query<{ id: number }>(
        `INSERT INTO "App_user" (email, password_hash, role, terms_accepted_at)
         VALUES ('otra@example.test', 'x', 'SHELTER', now()) RETURNING id`,
      );
      await other.query(
        `INSERT INTO "Shelter" (user_id, name, cif, address, province_id, locality, phone)
         VALUES ($1, 'Otra', 'G12345678', 'Calle 1', 20, 'Donostia', '943000000')`,
        [rows[0]?.id],
      );

      const pending = register(validBody).then((res) => res);
      // Wait until this sign-up is blocked on the CIF's unique index, then let the other one commit.
      await expect
        .poll(async () => {
          const { rows: waiting } = await getPool().query(
            `SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
          );
          return waiting.length;
        })
        .toBe(1);
      await other.query("COMMIT");

      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: CIF_TAKEN_MESSAGE });
      expect(await countRows("App_user")).toBe(1);
      expect(await countRows("Email_token")).toBe(0);
      expect(printedEmails()).toBe("");
    } finally {
      other.release();
    }
  });

  it("RN-17, RN-182: a taken CIF is rejected the same way whether the email has an account or not", async () => {
    await createShelter({ cif: "G12345678", email: "info@protectora-txiki.test" });

    const res = await register(validBody);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: CIF_TAKEN_MESSAGE });
    expect(printedEmails()).toBe("");
  });
});

describe("T-05 CU-02 POST /api/auth/register/shelter with an email that already has an account", () => {
  const printedEmails = captureEmails();
  const existingEmail = "info@protectora-txiki.test";

  beforeEach(async () => {
    await truncateAll();
    await createAdopter({ email: existingEmail });
  });

  it("RN-182: answers exactly as with a new email and creates nothing", async () => {
    const res = await register(validBody);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: REGISTERED_MESSAGE });
    expect(await countRows("App_user")).toBe(1);
    expect(await countRows("Shelter")).toBe(0);
    expect(await countRows("Email_token")).toBe(0);
  });

  it("RN-182: emails the owner a notice with the link to recover the password, and no verification link", async () => {
    await register(validBody);

    const printed = printedEmails();
    expect(printed).toContain(existingEmail);
    expect(printed).toContain("Alguien ha intentado registrarse con tu email");
    expect(printed).toContain("http://localhost:3000/recuperar-contrasena");
    expect(printed).not.toContain("/verificar-email");
  });

  it("RN-182: sends at most one notice every 5 minutes per account", async () => {
    await register(validBody);
    await register({ ...validBody, cif: "G87654321" });

    expect(printedEmails().match(/Asunto: Alguien ha intentado registrarse con tu email/g)).toHaveLength(1);
  });
});

describe("T-05 CU-02 POST /api/auth/register/shelter with missing or malformed data", () => {
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

  it("CU-02: rejects missing mandatory data, field by field", async () => {
    const res = await register({});

    expect(res.status).toBe(400);
    const required = "Este campo es obligatorio.";
    expect(res.body.fields).toMatchObject({
      email: required,
      password: required,
      name: required,
      cif: required,
      address: required,
      locality: required,
      phone: required,
      acceptTerms: required,
      provinceId: "Elige una provincia.",
    });
    expect(await countRows("App_user")).toBe(0);
  });

  it("CU-02: rejects a request with no JSON body, field by field", async () => {
    const res = await request(createApp()).post(ENDPOINT);

    expect(res.status).toBe(400);
    expect(res.body.fields).toMatchObject({ cif: "Este campo es obligatorio." });
  });

  it("CU-02: rejects a name or address made only of spaces", async () => {
    await expectInvalid({ ...validBody, name: "   " }, "name", "Este campo es obligatorio.");
    await expectInvalid({ ...validBody, address: " " }, "address", "Este campo es obligatorio.");
  });

  it("CU-02: rejects a malformed CIF", async () => {
    await expectInvalid({ ...validBody, cif: "12345678Z" }, "cif", "El CIF no tiene un formato válido.");
    await expectInvalid({ ...validBody, cif: "G1234" }, "cif", "El CIF no tiene un formato válido.");
  });

  it("CU-02: rejects a malformed email or phone number", async () => {
    await expectInvalid({ ...validBody, email: "info@" }, "email", "El email no tiene un formato válido.");
    await expectInvalid({ ...validBody, phone: "12345" }, "phone", "El teléfono no tiene un formato válido.");
  });

  it("RN-175: rejects a password shorter than 12 characters", async () => {
    await expectInvalid(
      { ...validBody, password: "once caract" },
      "password",
      "La contraseña debe tener al menos 12 caracteres.",
    );
  });

  it("CU-02: rejects a province id out of range", async () => {
    await expectInvalid({ ...validBody, provinceId: 99999 }, "provinceId", "Elige una provincia.");
  });
});
