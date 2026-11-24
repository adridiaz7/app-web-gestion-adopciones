import { recreateTestDatabase } from "./db.js";

/** Runs once per `vitest run`: (re)creates the test database from db/schema.sql. */
export default async function setup(): Promise<void> {
  const url = process.env["TEST_DATABASE_URL"] ?? "postgres://postgres@localhost:5432/lagun_test";
  await recreateTestDatabase(url);
}
