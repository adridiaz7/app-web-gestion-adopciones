/**
 * npm run db:reset — recreates the database in DATABASE_URL with db/schema.sql and
 * then loads db/seed.sql (skipped while the seed does not exist yet).
 * WARNING: drops every table and its data.
 *
 * Run with: node --env-file=.env scripts/db-reset.ts
 * psql reads the password from pgpass.conf (-w: never prompt).
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (copy .env.example to .env).");
  process.exit(1);
}

for (const file of ["db/schema.sql", "db/seed.sql"]) {
  if (!existsSync(file)) {
    console.log(`${file} does not exist yet, skipped.`);
    continue;
  }
  console.log(`Running ${file}…`);
  execFileSync("psql", ["-w", "-q", "-v", "ON_ERROR_STOP=1", "-d", databaseUrl, "-f", file], { stdio: "inherit" });
}
