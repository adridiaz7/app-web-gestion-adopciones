import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

let shelter: CreatedUser;
let shelterCookie: string;

const open = (reportedId: number) =>
  request(createApp()).post("/api/incidents").set("Cookie", shelterCookie).send({ reportedId, reason: "OTHER", description: "Algo" });

const incidentCount = async (): Promise<number> => (await getPool().query(`SELECT 1 FROM "Incident"`)).rowCount ?? 0;

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter();
  shelterCookie = await sessionCookie(shelter.id);
});

describe("T-54 CU-36 RN-29: a shelter only reports adopters who have sent it a request", () => {
  it("RN-29, CU-36: an adopter who never sent this shelter a request is answered as if they did not exist", async () => {
    const stranger = await createAdopter();
    const other = await createShelter();
    const pet = await createPet({ shelterId: other.id });
    const slot = await createVisitSlot({ shelterId: other.id });
    await createVisit({ adopterId: stranger.id, shelterId: other.id, petId: pet.id, slotId: slot.id });

    const unknown = await open(stranger.id);
    const missing = await open(999999);

    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual(missing.body);
    expect(unknown.body).toEqual({ error: "El adoptante no existe." });
    expect(await incidentCount()).toBe(0);
  });

  it("RN-29, CU-36: an adopter who sent this shelter a request can be reported", async () => {
    const adopter = await createAdopter();
    const pet = await createPet({ shelterId: shelter.id });
    const slot = await createVisitSlot({ shelterId: shelter.id });
    await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: pet.id, slotId: slot.id });

    expect((await open(adopter.id)).status).toBe(201);
    expect(await incidentCount()).toBe(1);
  });
});
