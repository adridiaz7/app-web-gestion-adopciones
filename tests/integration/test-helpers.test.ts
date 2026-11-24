import { beforeEach, describe, expect, it } from "vitest";
import { getPool } from "../../src/server/db/pool.js";
import { assertTestDatabase, truncateAll } from "../helpers/db.js";
import { createAdmin, createAdopter, createPet, createShelter } from "../helpers/factories.js";

const db = () => getPool();

async function count(table: string): Promise<number> {
  const { rows } = await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`);
  return rows[0]?.n ?? 0;
}

describe("T-02 test database", () => {
  beforeEach(truncateAll);

  it("starts from db/schema.sql with the catalogues loaded", async () => {
    expect(await count("Province")).toBe(52);
    expect(await count("Species")).toBe(2);
    expect(await count("Breed")).toBeGreaterThan(0);
  });

  it("truncateAll empties the data tables, keeps the catalogues and restarts the ids", async () => {
    const first = await createAdopter();
    await truncateAll();

    expect(await count("App_user")).toBe(0);
    expect(await count("Adopter")).toBe(0);
    expect(await count("Province")).toBe(52);

    const second = await createAdopter();
    expect(second.id).toBe(first.id);
  });

  it("refuses to work on a database whose name does not end in _test", () => {
    expect(() => assertTestDatabase("postgres://postgres@localhost:5432/lagun")).toThrow(/_test/);
    expect(() => assertTestDatabase("postgres://postgres@localhost:5432/lagun_test")).not.toThrow();
  });
});

describe("T-02 data factories", () => {
  beforeEach(truncateAll);

  it("createAdopter creates a verified ADOPTER user with its adopter profile", async () => {
    const adopter = await createAdopter({ firstName: "Ane" });

    const { rows } = await db().query<{ role: string; verified: boolean; first_name: string }>(
      `SELECT u.role, u.email_verified_at IS NOT NULL AS verified, a.first_name
         FROM "App_user" u JOIN "Adopter" a ON a.user_id = u.id
        WHERE u.id = $1`,
      [adopter.id],
    );
    expect(rows).toEqual([{ role: "ADOPTER", verified: true, first_name: "Ane" }]);
  });

  it("createAdopter gives each adopter a different email", async () => {
    const a = await createAdopter();
    const b = await createAdopter();
    expect(a.email).not.toBe(b.email);
  });

  it("createShelter creates a VALIDATED shelter by default and accepts another status", async () => {
    const validated = await createShelter();
    const pending = await createShelter({ validationStatus: "PENDING" });

    const { rows } = await db().query<{ user_id: number; validation_status: string; role: string }>(
      `SELECT s.user_id, s.validation_status, u.role
         FROM "Shelter" s JOIN "App_user" u ON u.id = s.user_id
        ORDER BY s.user_id`,
    );
    expect(rows).toEqual([
      { user_id: validated.id, validation_status: "VALIDATED", role: "SHELTER" },
      { user_id: pending.id, validation_status: "PENDING", role: "SHELTER" },
    ]);
  });

  it("createAdmin creates an ADMIN user", async () => {
    const admin = await createAdmin();

    const { rows } = await db().query<{ role: string }>(`SELECT role FROM "App_user" WHERE id = $1`, [admin.id]);
    expect(rows).toEqual([{ role: "ADMIN" }]);
  });

  it("createPet creates an AVAILABLE pet of the given shelter", async () => {
    const shelter = await createShelter();
    const pet = await createPet({ shelterId: shelter.id, name: "Txuri" });

    const { rows } = await db().query<{ shelter_id: number; name: string; status: string }>(
      `SELECT shelter_id, name, status FROM "Pet" WHERE id = $1`,
      [pet.id],
    );
    expect(rows).toEqual([{ shelter_id: shelter.id, name: "Txuri", status: "AVAILABLE" }]);
  });
});
