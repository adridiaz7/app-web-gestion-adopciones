import { readFileSync } from "node:fs";
import pg from "pg";
import { getPool } from "../../src/server/db/pool.js";

const SCHEMA_FILE = new URL("../../db/schema.sql", import.meta.url);

/** Catalogue tables loaded by db/schema.sql: truncateAll keeps them. */
const CATALOGUE_TABLES = ["Province", "Species", "Breed"];

/** Guard against wiping a real database: the test database name must end in _test. */
export function assertTestDatabase(url: string): string {
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to reset "${name}": the test database name must end in _test.`);
  }
  return name;
}

/** Creates the test database if it does not exist and runs db/schema.sql on it (drops everything). */
export async function recreateTestDatabase(url: string): Promise<void> {
  const name = assertTestDatabase(url);

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [name]);
    if (rowCount === 0) {
      await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
    }
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("SET client_min_messages = warning");
    await client.query(readFileSync(SCHEMA_FILE, "utf8"));
  } finally {
    await client.end();
  }
}

/** Empties every data table (keeping the catalogues) and restarts the identity sequences. */
export async function truncateAll(): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT (tablename = ANY($1))`,
    [CATALOGUE_TABLES],
  );
  if (rows.length === 0) return;
  const tables = rows.map((r) => pg.escapeIdentifier(r.tablename)).join(", ");
  await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}
