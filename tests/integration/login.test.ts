import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { errorHandler } from "../../src/server/middlewares/error-handler.js";
import { loadSession, requireRole } from "../../src/server/middlewares/session.js";
import { hashPassword } from "../../src/server/services/passwords.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createAdopter, createShelter, type CreatedUser } from "../helpers/factories.js";

const LOGIN = "/api/auth/login";
const LOGOUT = "/api/auth/logout";
const ME = "/api/auth/me";
const COOKIE = "lagun_session";

const PASSWORD = "doce caracteres";
const WRONG_CREDENTIALS = "El email o la contraseña no son correctos.";

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

const login = (body: object, app = createApp()) => request(app).post(LOGIN).send(body);

/** Value of the session cookie set by a response, or undefined. */
function sessionCookie(res: request.Response): string | undefined {
  const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const cookie = cookies.find((c) => c.startsWith(`${COOKIE}=`));
  return cookie?.slice(COOKIE.length + 1).split(";")[0];
}

function setCookieHeader(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  return cookies.find((c) => c.startsWith(`${COOKIE}=`)) ?? "";
}

async function sessions(): Promise<{ token_hash: string; user_id: number; days: number }[]> {
  const { rows } = await getPool().query<{ token_hash: string; user_id: number; days: number }>(
    `SELECT token_hash, user_id, round(extract(epoch FROM expires_at - now()) / 86400)::int AS days FROM "Session"`,
  );
  return rows;
}

async function loginFailures(): Promise<{ entity_id: number | null; ip_address: string | null; actor_user_id: number | null }[]> {
  const { rows } = await getPool().query<{ entity_id: number | null; ip_address: string | null; actor_user_id: number | null }>(
    `SELECT entity_id, host(ip_address) AS ip_address, actor_user_id FROM "Audit_log" WHERE action = 'LOGIN_FAILED'`,
  );
  return rows;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("T-07 CU-04 POST /api/auth/login", () => {
  let adopter: CreatedUser;

  beforeEach(async () => {
    await truncateAll();
    adopter = await createAdopter({ email: "ane@example.test", passwordHash });
  });

  it("CU-04: opens a session with a correct email and password", async () => {
    const res = await login({ email: "ane@example.test", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { id: adopter.id, email: "ane@example.test", role: "ADOPTER" } });
    const token = sessionCookie(res);
    expect(token).toBeTruthy();
    expect(await sessions()).toEqual([{ token_hash: sha256(token ?? ""), user_id: adopter.id, days: 30 }]);
  });

  it("CU-04: the session cookie is httpOnly, SameSite=Lax and lasts 30 days (RN-176)", async () => {
    const res = await login({ email: "ane@example.test", password: PASSWORD });

    const header = setCookieHeader(res);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Path=\//);
    expect(header).toMatch(new RegExp(`Max-Age=${String(30 * 24 * 3600)}`));
  });

  it("CU-04: the email is not case-sensitive", async () => {
    const res = await login({ email: " ANE@Example.test ", password: PASSWORD });

    expect(res.status).toBe(200);
  });

  it("CU-04: lets shelters and the administrator log in too", async () => {
    await createShelter({ email: "protectora@example.test", passwordHash, validationStatus: "PENDING" });
    await createAdmin({ email: "admin@example.test", passwordHash });

    expect((await login({ email: "protectora@example.test", password: PASSWORD })).body.user.role).toBe("SHELTER");
    expect((await login({ email: "admin@example.test", password: PASSWORD })).body.user.role).toBe("ADMIN");
  });

  it("CU-04, RN-208: rejects a wrong password and records the failed login", async () => {
    const res = await login({ email: "ane@example.test", password: "otra contraseña" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: WRONG_CREDENTIALS });
    expect(sessionCookie(res)).toBeUndefined();
    expect(await sessions()).toEqual([]);
    expect(await loginFailures()).toEqual([{ entity_id: adopter.id, ip_address: expect.any(String), actor_user_id: null }]);
  });

  it("CU-04, RN-208: rejects an unknown email with the same answer and records the failed login", async () => {
    const res = await login({ email: "nadie@example.test", password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: WRONG_CREDENTIALS });
    expect(await loginFailures()).toEqual([{ entity_id: null, ip_address: expect.any(String), actor_user_id: null }]);
  });

  it("RN-209: the failed-login record stores neither the password nor the email tried", async () => {
    await login({ email: "nadie@example.test", password: "contraseña secreta" });

    const { rows } = await getPool().query<{ details: object }>(`SELECT details FROM "Audit_log"`);
    expect(JSON.stringify(rows)).not.toContain("secreta");
    expect(JSON.stringify(rows)).not.toContain("nadie@example.test");
  });

  it("CU-04, RN-07: rejects an account whose email is not verified", async () => {
    await createAdopter({ email: "sin-verificar@example.test", passwordHash, verified: false });

    const res = await login({ email: "sin-verificar@example.test", password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: "Tienes que verificar tu email antes de iniciar sesión. Revisa tu correo o pide un enlace nuevo.",
    });
    expect(await sessions()).toEqual([]);
  });

  it("CU-04: an unverified account with a wrong password gets the wrong-credentials answer", async () => {
    await createAdopter({ email: "sin-verificar@example.test", passwordHash, verified: false });

    const res = await login({ email: "sin-verificar@example.test", password: "otra contraseña" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: WRONG_CREDENTIALS });
  });

  it("RN-10, RN-154: rejects an account with an active suspension", async () => {
    await getPool().query(`INSERT INTO "Suspension" (user_id, reason) VALUES ($1, 'FRAUD')`, [adopter.id]);

    const res = await login({ email: "ane@example.test", password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Tu cuenta está suspendida. No puedes iniciar sesión mientras dure la suspensión." });
    expect(await sessions()).toEqual([]);
  });

  it("RN-10: lets in an account whose suspension has ended", async () => {
    await getPool().query(
      `INSERT INTO "Suspension" (user_id, reason, started_at, ended_at)
       VALUES ($1, 'FRAUD', now() - interval '2 days', now() - interval '1 day')`,
      [adopter.id],
    );

    expect((await login({ email: "ane@example.test", password: PASSWORD })).status).toBe(200);
  });

  it("CU-04, RN-11: rejects a deleted account as wrong credentials", async () => {
    await getPool().query(`UPDATE "App_user" SET deleted_at = now() WHERE id = $1`, [adopter.id]);

    const res = await login({ email: "ane@example.test", password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: WRONG_CREDENTIALS });
    expect(await sessions()).toEqual([]);
  });

  it("CU-04: rejects a request without email or password", async () => {
    const res = await request(createApp()).post(LOGIN);

    expect(res.status).toBe(400);
    expect(res.body.fields).toMatchObject({ email: "Este campo es obligatorio.", password: "Este campo es obligatorio." });
  });

  it("CU-04: rejects a password longer than 256 characters without hashing it", async () => {
    const res = await login({ email: "ane@example.test", password: "a".repeat(257) });

    expect(res.status).toBe(400);
  });

  it("RN-179: blocks the 11th attempt from the same IP within 15 minutes, even with the right password", async () => {
    const app = createApp();
    for (let i = 0; i < 10; i++) {
      expect((await login({ email: "ane@example.test", password: "otra contraseña" }, app)).status).toBe(401);
    }

    const res = await login({ email: "ane@example.test", password: PASSWORD }, app);

    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: "Has hecho demasiados intentos de inicio de sesión. Vuelve a intentarlo dentro de unos minutos.",
    });
    expect(await sessions()).toEqual([]);
  });
});

describe("T-07 CU-04 session, GET /api/auth/me and POST /api/auth/logout", () => {
  let adopter: CreatedUser;

  beforeEach(async () => {
    await truncateAll();
    adopter = await createAdopter({ email: "ane@example.test", passwordHash });
  });

  async function loggedInToken(): Promise<string> {
    const token = sessionCookie(await login({ email: "ane@example.test", password: PASSWORD }));
    if (!token) throw new Error("no session cookie");
    return token;
  }

  const me = (token?: string) => {
    const req = request(createApp()).get(ME);
    return token ? req.set("Cookie", `${COOKIE}=${token}`) : req;
  };

  async function setDaysLeft(days: number): Promise<void> {
    await getPool().query(`UPDATE "Session" SET expires_at = now() + make_interval(days => $1)`, [days]);
  }

  it("CU-04: the session cookie identifies the user", async () => {
    const res = await me(await loggedInToken());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { id: adopter.id, email: "ane@example.test", role: "ADOPTER" } });
  });

  it("CU-04: without a session, asks to log in", async () => {
    const res = await me();

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Tienes que iniciar sesión." });
  });

  it("CU-04: an unknown session token is not valid", async () => {
    await loggedInToken();

    expect((await me("token-inventado")).status).toBe(401);
  });

  it("RN-176: an expired session is not valid", async () => {
    const token = await loggedInToken();
    await getPool().query(`UPDATE "Session" SET expires_at = now() - interval '1 second'`);

    expect((await me(token)).status).toBe(401);
  });

  it("RN-176: a session used with less than 15 days left is renewed for another 30 days", async () => {
    const token = await loggedInToken();
    await setDaysLeft(14);

    const res = await me(token);

    expect(res.status).toBe(200);
    expect((await sessions())[0]?.days).toBe(30);
    expect(setCookieHeader(res)).toMatch(new RegExp(`Max-Age=${String(30 * 24 * 3600)}`));
    expect(sessionCookie(res)).toBe(token);
  });

  it("RN-176: a session with 15 days or more left is not renewed", async () => {
    const token = await loggedInToken();
    await setDaysLeft(16);

    const res = await me(token);

    expect(res.status).toBe(200);
    expect((await sessions())[0]?.days).toBe(16);
    expect(sessionCookie(res)).toBeUndefined();
  });

  it("RN-11: the session of a deleted account is not valid", async () => {
    const token = await loggedInToken();
    await getPool().query(`UPDATE "App_user" SET deleted_at = now() WHERE id = $1`, [adopter.id]);

    expect((await me(token)).status).toBe(401);
  });

  it("CU-04: logging out deletes the session at once and clears the cookie", async () => {
    const token = await loggedInToken();

    const res = await request(createApp()).post(LOGOUT).set("Cookie", `${COOKIE}=${token}`);

    expect(res.status).toBe(204);
    expect(setCookieHeader(res)).toMatch(new RegExp(`${COOKIE}=;`));
    expect(await sessions()).toEqual([]);
    expect((await me(token)).status).toBe(401);
  });

  it("CU-04: logging out without a session does nothing and does not fail", async () => {
    await loggedInToken();

    const res = await request(createApp()).post(LOGOUT);

    expect(res.status).toBe(204);
    expect(await sessions()).toHaveLength(1);
  });
});

describe("T-07 role middleware", () => {
  /** A small app with a route only for administrators. */
  function adminOnlyApp(): express.Express {
    const app = express();
    app.use(loadSession);
    app.get("/admin-only", requireRole("ADMIN"), (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);
    return app;
  }

  beforeEach(truncateAll);

  async function tokenFor(email: string): Promise<string> {
    const token = sessionCookie(await login({ email, password: PASSWORD }));
    if (!token) throw new Error("no session cookie");
    return token;
  }

  it("CU-04: a route for a role answers 401 without a session", async () => {
    const res = await request(adminOnlyApp()).get("/admin-only");

    expect(res.status).toBe(401);
  });

  it("CU-04: a route for a role answers 403 to another role", async () => {
    await createAdopter({ email: "ane@example.test", passwordHash });

    const res = await request(adminOnlyApp())
      .get("/admin-only")
      .set("Cookie", `${COOKIE}=${await tokenFor("ane@example.test")}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "No tienes permiso para realizar esta acción." });
  });

  it("CU-04: a route for a role lets that role in", async () => {
    await createAdmin({ email: "admin@example.test", passwordHash });

    const res = await request(adminOnlyApp())
      .get("/admin-only")
      .set("Cookie", `${COOKIE}=${await tokenFor("admin@example.test")}`);

    expect(res.status).toBe(200);
  });
});
