import pg from "pg";
import { getConfig } from "../config.js";

// bigint (int8) comes back as a string by default. Ids and counts never get near 2^53,
// so they are parsed as plain numbers.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

let pool: pg.Pool | undefined;

/** The shared pool, created on first use from DATABASE_URL (the password comes from pgpass.conf). */
export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: getConfig().databaseUrl });
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
}
