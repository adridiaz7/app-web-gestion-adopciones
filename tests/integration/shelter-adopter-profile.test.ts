import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let shelter: CreatedUser;
let adopter: CreatedUser;
let cookie: string;

const profile = (adopterId: number | string, as = cookie) => request(createApp()).get(`/api/shelter/adopters/${String(adopterId)}`).set("Cookie", as);

/** A visit of the adopter for a new pet of `shelterId`, in a slot starting `days` from now. */
async function visit(days: number, status: "PENDING" | "CONFIRMED" | "NO_SHOW" | "COMPLETED", shelterId = shelter.id, petName = "Luna"): Promise<number> {
  const pet = await createPet({ shelterId, name: petName });
  const slot = await createVisitSlot({ shelterId, startsAt: new Date(Date.now() + days * DAY) });
  const { id } = await createVisit({ adopterId: adopter.id, shelterId, petId: pet.id, slotId: slot.id, status: status === "PENDING" ? "PENDING" : "CONFIRMED" });
  if (status === "NO_SHOW" || status === "COMPLETED") {
    await getPool().query(`UPDATE "Visit" SET status = $2, attendance_marked_by = 'SHELTER', attendance_marked_at = now() WHERE id = $1`, [id, status]);
  }
  return id;
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter();
  adopter = await createAdopter({ firstName: "Ane", lastName: "Etxeberria" });
  cookie = await sessionCookie(shelter.id);
});

describe("T-50 CU-22 GET /api/shelter/adopters/:id", () => {
  it("CU-22, RN-27, RN-29: shows the name, province, household data and the history of visits and no-shows with this shelter", async () => {
    await getPool().query(
      `UPDATE "Adopter" SET housing_type = 'HOUSE', has_outdoor_space = true, housing_tenure = 'OWNED', household_members = 2,
              has_children = false, has_other_pets = true, other_pets_description = 'Un perro mayor',
              has_pet_experience = true, hours_alone_per_day = 3 WHERE user_id = $1`,
      [adopter.id],
    );
    const { rows } = await getPool().query<{ name: string }>(`SELECT p.name FROM "Adopter" a JOIN "Province" p ON p.id = a.province_id WHERE a.user_id = $1`, [adopter.id]);
    const missed = await visit(-20, "NO_SHOW", shelter.id, "Toby");
    const done = await visit(-10, "COMPLETED", shelter.id, "Kira");
    const next = await visit(5, "PENDING", shelter.id, "Luna");

    const res = await profile(adopter.id);

    expect(res.status).toBe(200);
    expect(res.body.adopter).toEqual({
      id: adopter.id,
      name: "Ane Etxeberria",
      provinceName: rows[0]?.name,
      household: {
        housingType: "HOUSE",
        hasOutdoorSpace: true,
        housingTenure: "OWNED",
        householdMembers: 2,
        hasChildren: false,
        hasOtherPets: true,
        otherPetsDescription: "Un perro mayor",
        hasPetExperience: true,
        hoursAlonePerDay: 3,
      },
      noShows: 1,
      visits: [
        { id: next, petName: "Luna", status: "PENDING", startsAt: expect.any(String), endsAt: expect.any(String) },
        { id: done, petName: "Kira", status: "COMPLETED", startsAt: expect.any(String), endsAt: expect.any(String) },
        { id: missed, petName: "Toby", status: "NO_SHOW", startsAt: expect.any(String), endsAt: expect.any(String) },
      ],
    });
  });

  it("RN-29: the history with other shelters is never shown", async () => {
    const other = await createShelter();
    await visit(-15, "NO_SHOW", other.id, "Otra");
    const mine = await visit(4, "CONFIRMED");

    const res = await profile(adopter.id);

    expect(res.status).toBe(200);
    expect(res.body.adopter.visits.map((v: { id: number }) => v.id)).toEqual([mine]);
    expect(res.body.adopter.noShows).toBe(0);
  });

  it("RN-29: an adopter who has never sent a request to this shelter is not shown", async () => {
    const other = await createShelter();
    await visit(4, "PENDING", other.id);
    for (const id of [adopter.id, 999999]) {
      const res = await profile(id);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "El adoptante no existe." });
    }
  });

  it("CU-22: only shelters see adopter profiles, and the id is checked", async () => {
    await visit(4, "PENDING");
    expect((await request(createApp()).get(`/api/shelter/adopters/${String(adopter.id)}`)).status).toBe(401);
    expect((await profile(adopter.id, await sessionCookie(adopter.id))).status).toBe(403);
    expect((await profile("abc")).status).toBe(400);
  });
});
