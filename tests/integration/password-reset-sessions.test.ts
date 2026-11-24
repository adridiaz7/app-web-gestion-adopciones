import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { createEmailToken } from "../../src/server/services/email-tokens.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, type CreatedUser } from "../helpers/factories.js";

const HALF_HOUR = 1800;
const NEW_PASSWORD = "contraseña nueva";

const reset = (body: object) => request(createApp()).post("/api/auth/reset-password").send(body);
const me = (cookie: string) => request(createApp()).get("/api/auth/me").set("Cookie", cookie);

async function sessionCount(userId: number): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM "Session" WHERE user_id = $1`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}

describe("T-44 CU-05 closing sessions on password reset", () => {
  let user: CreatedUser;

  beforeEach(async () => {
    await truncateAll();
    user = await createAdopter({ email: "ane@example.test" });
  });

  it("CU-05: resetting the password closes every open session of the account", async () => {
    const first = await sessionCookie(user.id);
    const second = await sessionCookie(user.id);
    expect((await me(first)).status).toBe(200);
    const token = await createEmailToken(getPool(), user.id, "RESET_PASSWORD", HALF_HOUR);

    expect((await reset({ token, password: NEW_PASSWORD })).status).toBe(200);

    expect((await me(first)).status).toBe(401);
    expect((await me(second)).status).toBe(401);
    expect(await sessionCount(user.id)).toBe(0);
  });

  it("CU-05: does not close the sessions of other accounts", async () => {
    const other = await createAdopter({ email: "otra@example.test" });
    const otherCookie = await sessionCookie(other.id);
    await sessionCookie(user.id);
    const token = await createEmailToken(getPool(), user.id, "RESET_PASSWORD", HALF_HOUR);

    await reset({ token, password: NEW_PASSWORD });

    expect((await me(otherCookie)).status).toBe(200);
  });

  it("CU-05: keeps the sessions open when the reset link is not valid", async () => {
    const cookie = await sessionCookie(user.id);

    expect((await reset({ token: "no-existe", password: NEW_PASSWORD })).status).toBe(400);

    expect((await me(cookie)).status).toBe(200);
  });
});
