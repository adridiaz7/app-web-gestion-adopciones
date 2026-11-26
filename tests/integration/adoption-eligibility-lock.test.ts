import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, createVisit, createVisitSlot } from "../helpers/factories.js";

const DAY = 24 * 60 * 60 * 1000;
const WAIT_MS = 1500;

const household = {
  housingType: "HOUSE",
  hasOutdoorSpace: true,
  housingTenure: "OWNED",
  householdMembers: 2,
  hasChildren: false,
  hasOtherPets: false,
  otherPetsDescription: null,
  hasPetExperience: true,
  hoursAlonePerDay: 3,
};

let cookie: string;
let petId: number;
let locker: PoolClient | null = null;

/** Another transaction holds the pet's row, as a shelter changing its status would. */
async function lockPetRow(): Promise<void> {
  locker = await getPool().connect();
  await locker.query("BEGIN");
  await locker.query(`SELECT 1 FROM "Pet" WHERE id = $1 FOR UPDATE`, [petId]);
}

async function releasePetRow(): Promise<void> {
  if (!locker) return;
  await locker.query("ROLLBACK");
  locker.release();
  locker = null;
}

/** Whether the request answers before WAIT_MS. */
async function answersWhileLocked(pending: Promise<unknown>): Promise<boolean> {
  const timeout = new Promise<"waiting">((resolve) => setTimeout(() => { resolve("waiting"); }, WAIT_MS));
  return (await Promise.race([pending.then(() => "answered" as const), timeout])) === "answered";
}

beforeEach(async () => {
  await truncateAll();
  const shelter = await createShelter({ name: "Huellas" });
  const adopter = await createAdopter();
  cookie = await sessionCookie(adopter.id);
  petId = (await createPet({ shelterId: shelter.id, name: "Luna" })).id;
  const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() - 3 * DAY) });
  const { id } = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId, slotId: slot.id, status: "CONFIRMED" });
  await getPool().query(`UPDATE "Visit" SET status = 'COMPLETED', attendance_marked_by = 'SYSTEM', attendance_marked_at = now() WHERE id = $1`, [id]);
});

afterEach(releasePetRow);

describe("T-54 CU-11: the adoption eligibility is a read that does not lock the pet", () => {
  it("CU-11: the eligibility answers while another transaction holds the pet's row", async () => {
    await lockPetRow();

    const pending = request(createApp()).get(`/api/adopter/pets/${String(petId)}/adoption-eligibility`).set("Cookie", cookie).then((res) => res);

    expect(await answersWhileLocked(pending)).toBe(true);
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.body.eligibility).toEqual({ canRequest: true, reason: null, message: null });
  });

  it("RN-171, CU-27: the adoption request still waits for the pet's row, and then succeeds", async () => {
    await lockPetRow();

    const pending = request(createApp()).post("/api/adopter/adoptions").set("Cookie", cookie).send({ petId, household, answers: {} }).then((res) => res);

    expect(await answersWhileLocked(pending)).toBe(false);
    await releasePetRow();
    expect((await pending).status).toBe(201);
  });
});
