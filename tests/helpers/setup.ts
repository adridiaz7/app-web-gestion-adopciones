import { afterAll } from "vitest";
import { closePool } from "../../src/server/db/pool.js";

// Every test file gets its own module graph, and so its own pool: close it at the end.
afterAll(closePool);
