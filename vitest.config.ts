import { defineConfig } from "vitest/config";

// Integration tests use their own database, recreated from db/schema.sql at the start of
// every run (tests/helpers/global-setup.ts). They never use db/seed.sql.
const testDatabaseUrl = process.env["TEST_DATABASE_URL"] ?? "postgres://postgres@localhost:5432/lagun_test";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: { NODE_ENV: "test", DATABASE_URL: testDatabaseUrl },
    globalSetup: ["tests/helpers/global-setup.ts"],
    setupFiles: ["tests/helpers/setup.ts"],
    // The integration tests share one database, so test files run one after another.
    fileParallelism: false,
  },
});
