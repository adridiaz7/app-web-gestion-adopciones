import type pg from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import { getPool } from "../../src/server/db/pool.js";
import { withTransaction } from "../../src/server/db/transaction.js";
import { truncateAll } from "../helpers/db.js";

async function countUsers(): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(`SELECT count(*)::int AS n FROM "App_user"`);
  return rows[0]?.n ?? 0;
}

async function insertUser(client: pg.PoolClient, email: string): Promise<void> {
  await client.query(
    `INSERT INTO "App_user" (email, password_hash, role, terms_accepted_at) VALUES ($1, 'x', 'ADMIN', now())`,
    [email],
  );
}

describe("T-02 withTransaction", () => {
  beforeEach(truncateAll);

  it("RN-171: commits every change when the callback succeeds and returns its result", async () => {
    const result = await withTransaction(async (client) => {
      await insertUser(client, "a@example.test");
      await insertUser(client, "b@example.test");
      return "done";
    });

    expect(result).toBe("done");
    expect(await countUsers()).toBe(2);
  });

  it("RN-171: rolls back every change and rethrows when the callback fails", async () => {
    await expect(
      withTransaction(async (client) => {
        await insertUser(client, "a@example.test");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await countUsers()).toBe(0);
  });

  it("RN-171: rolls back when a statement violates a constraint", async () => {
    await expect(
      withTransaction(async (client) => {
        await insertUser(client, "a@example.test");
        await insertUser(client, "A@example.test"); // app_user_email_uq (case-insensitive)
      }),
    ).rejects.toMatchObject({ code: "23505" });

    expect(await countUsers()).toBe(0);
  });

  it("returns the client to the pool after both commit and rollback", async () => {
    const pool = getPool();
    await withTransaction(async () => "ok");
    await withTransaction(async () => {
      throw new Error("boom");
    }).catch(() => undefined);

    expect(pool.totalCount - pool.idleCount).toBe(0);
  });
});

describe("T-02 pool", () => {
  it("returns bigint columns (ids, counts) as JavaScript numbers", async () => {
    const { rows } = await getPool().query<{ n: unknown }>(`SELECT 42::bigint AS n`);
    expect(rows[0]?.n).toBe(42);
  });
});
