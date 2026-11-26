import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createAdopter, createPet, createShelter, createVisit, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

let shelter: CreatedUser;
let adopter: CreatedUser;
let cookie: string;

const notesUrl = (adopterId = adopter.id) => `/api/shelter/adopters/${String(adopterId)}/notes`;
const noteUrl = (noteId: number, adopterId = adopter.id) => `${notesUrl(adopterId)}/${String(noteId)}`;
const list = (as = cookie, adopterId = adopter.id) => request(createApp()).get(notesUrl(adopterId)).set("Cookie", as);
const create = (body: unknown, as = cookie, adopterId = adopter.id) => request(createApp()).post(notesUrl(adopterId)).set("Cookie", as).send(body as object);
const edit = (noteId: number, body: unknown, as = cookie) => request(createApp()).put(noteUrl(noteId)).set("Cookie", as).send(body as object);
const remove = (noteId: number, as = cookie) => request(createApp()).delete(noteUrl(noteId)).set("Cookie", as);

/** The adopter sends a visit request to the shelter, so the shelter can see them (RN-29). */
async function request_(shelterId = shelter.id): Promise<void> {
  const pet = await createPet({ shelterId });
  const slot = await createVisitSlot({ shelterId });
  await createVisit({ adopterId: adopter.id, shelterId, petId: pet.id, slotId: slot.id });
}

async function noteRows(): Promise<{ shelter_id: number; adopter_id: number; body: string }[]> {
  const { rows } = await getPool().query<{ shelter_id: number; adopter_id: number; body: string }>(`SELECT shelter_id, adopter_id, body FROM "Adopter_note" ORDER BY id`);
  return rows;
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter();
  adopter = await createAdopter();
  cookie = await sessionCookie(shelter.id);
});

describe("T-35 CU-52 internal notes about an adopter", () => {
  it("RN-204, CU-52: writes a note with its date and lists the shelter's notes, newest first", async () => {
    await request_();

    const first = await create({ body: "  Muy atenta con Luna en la visita.  " });
    expect(first.status).toBe(201);
    expect(first.body.note).toEqual({ id: expect.any(Number), body: "Muy atenta con Luna en la visita.", createdAt: expect.any(String), updatedAt: expect.any(String) });
    await getPool().query(`UPDATE "Adopter_note" SET created_at = now() - interval '1 day'`);
    expect((await create({ body: "Pregunta por el seguro." })).status).toBe(201);

    const res = await list();

    expect(res.status).toBe(200);
    expect(res.body.notes.map((n: { body: string }) => n.body)).toEqual(["Pregunta por el seguro.", "Muy atenta con Luna en la visita."]);
    expect(await noteRows()).toHaveLength(2);
  });

  it("CU-52: edits a note and keeps its creation date", async () => {
    await request_();
    const { id, createdAt } = (await create({ body: "Primera impresión" })).body.note as { id: number; createdAt: string };

    const res = await edit(id, { body: "Primera impresión, corregida" });

    expect(res.status).toBe(200);
    expect(res.body.note).toMatchObject({ id, body: "Primera impresión, corregida", createdAt });
    expect(await noteRows()).toEqual([{ shelter_id: shelter.id, adopter_id: adopter.id, body: "Primera impresión, corregida" }]);
  });

  it("CU-52: deletes a note", async () => {
    await request_();
    const { id } = (await create({ body: "Para borrar" })).body.note as { id: number };

    const res = await remove(id);

    expect(res.status).toBe(204);
    expect(await noteRows()).toEqual([]);
  });

  it("CU-52: rejects an empty note, when writing and when editing", async () => {
    await request_();
    const { id } = (await create({ body: "Algo" })).body.note as { id: number };

    for (const body of [{}, { body: "" }, { body: "   " }]) {
      expect((await create(body)).status, JSON.stringify(body)).toBe(400);
      expect((await edit(id, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await noteRows()).toEqual([{ shelter_id: shelter.id, adopter_id: adopter.id, body: "Algo" }]);
  });

  it("RN-204, CU-52: the adopter must have sent some request to this shelter", async () => {
    const other = await createShelter();
    await request_(other.id);

    expect((await create({ body: "Nota" })).status).toBe(404);
    expect((await list()).status).toBe(404);
    expect(await noteRows()).toEqual([]);
  });

  it("RN-204: a shelter neither sees nor changes another shelter's notes", async () => {
    const other = await createShelter();
    const otherCookie = await sessionCookie(other.id);
    await request_();
    await request_(other.id);
    const { id } = (await create({ body: "Nota privada" })).body.note as { id: number };

    expect((await list(otherCookie)).body).toEqual({ notes: [] });
    expect((await edit(id, { body: "Cambiada" }, otherCookie)).status).toBe(404);
    expect((await remove(id, otherCookie)).status).toBe(404);
    expect(await noteRows()).toEqual([{ shelter_id: shelter.id, adopter_id: adopter.id, body: "Nota privada" }]);
  });

  it("RN-204: a session is required and only shelters use the notes; the adopter never sees them", async () => {
    await request_();
    const { id } = (await create({ body: "Nota privada" })).body.note as { id: number };
    const adopterCookie = await sessionCookie(adopter.id);
    const adminCookie = await sessionCookie((await createAdmin()).id);

    expect((await request(createApp()).get(notesUrl())).status).toBe(401);
    expect((await request(createApp()).post(notesUrl()).send({ body: "x" })).status).toBe(401);
    expect((await request(createApp()).put(noteUrl(id)).send({ body: "x" })).status).toBe(401);
    expect((await request(createApp()).delete(noteUrl(id))).status).toBe(401);
    for (const other of [adopterCookie, adminCookie]) {
      expect((await list(other)).status).toBe(403);
      expect((await create({ body: "x" }, other)).status).toBe(403);
      expect((await edit(id, { body: "x" }, other)).status).toBe(403);
      expect((await remove(id, other)).status).toBe(403);
    }
    expect(await noteRows()).toEqual([{ shelter_id: shelter.id, adopter_id: adopter.id, body: "Nota privada" }]);
  });
});
