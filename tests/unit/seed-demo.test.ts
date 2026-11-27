import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { psqlEnv } from "../../scripts/db-reset.js";
import { notificationTemplates } from "../../src/server/services/notification-templates.js";

/** The SQL file without its comment lines, split into statements. */
function statements(file: string): string[] {
  const sql = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

describe("T-55: robust demo seed", () => {
  it("T-55: schema.sql and seed.sql set the client encoding to UTF8 before anything else", () => {
    for (const file of ["db/schema.sql", "db/seed.sql"]) {
      expect(statements(file)[0]).toBe("SET client_encoding = 'UTF8'");
    }
  });

  it("T-55: db:reset runs psql with PGCLIENTENCODING=UTF8, keeping the rest of the environment", () => {
    const env = psqlEnv({ PATH: "C:\\bin", PGCLIENTENCODING: "WIN1252" });
    expect(env).toEqual({ PATH: "C:\\bin", PGCLIENTENCODING: "UTF8" });
  });

  it("T-55: the seed looks pets up by name and by their shelter's CIF, never by name only", () => {
    const byName = statements("db/seed.sql").filter((statement) => /JOIN "Pet" \w+ ON \w+\.name =/.test(statement));
    expect(byName.length).toBeGreaterThan(0);
    for (const statement of byName) expect(statement).toMatch(/\.cif\b/);
  });

  it("T-55, RN-143: the seed creates notifications only of the types the services generate", () => {
    const inserts = statements("db/seed.sql").filter((statement) => statement.startsWith('INSERT INTO "Notification"'));
    const types = inserts.flatMap((statement) => [...statement.matchAll(/'([A-Z_]+)' AS type\b/g)].map((match) => match[1]));
    expect(types.length).toBeGreaterThan(0);
    for (const type of types) expect(Object.keys(notificationTemplates)).toContain(type);
  });
});
