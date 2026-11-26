/**
 * npm run db:reset — recreates the database in DATABASE_URL with db/schema.sql and
 * then loads db/seed.sql (skipped while the seed does not exist yet). Finally copies
 * the demo photos of db/seed-photos/ to uploads/seed/, where the seed's rows point (T-46).
 * WARNING: drops every table and its data.
 *
 * Run with: node --env-file=.env scripts/db-reset.ts
 * psql reads the password from pgpass.conf (-w: never prompt).
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

/** URL prefix of the demo photos in db/seed.sql. */
export const SEED_UPLOADS_URL = "/uploads/seed/";

/**
 * T-46: copies the demo photos and logos to <uploadsDir>/seed/, keeping their folders.
 * A previous copy is replaced; the rest of uploads/ (the users' files) is left alone.
 * Text files (CREDITOS.md) are not copied.
 */
export function copySeedPhotos(sourceDir: string, uploadsDir: string): void {
  const target = join(uploadsDir, "seed");
  rmSync(target, { recursive: true, force: true });
  cpSync(sourceDir, target, { recursive: true, filter: (source) => !source.endsWith(".md") });
}

function main(): void {
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

  // Same folder as the server (config.ts): UPLOADS_DIR, or uploads/ in the project root.
  const uploadsDir = resolve(process.env["UPLOADS_DIR"] ?? "uploads");
  copySeedPhotos("db/seed-photos", uploadsDir);
  console.log(`Demo photos copied to ${join(uploadsDir, "seed")}.`);
}

if (import.meta.main) main();
