import type pg from "pg";
import { getPool } from "./pool.js";

/** A pool or a client inside a transaction: models accept either, so services decide the transaction. */
export type Db = pg.Pool | pg.PoolClient;

/**
 * RN-171: runs `fn` in a single transaction. Commits if it resolves; rolls back and
 * rethrows if it throws. The client always goes back to the pool.
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
