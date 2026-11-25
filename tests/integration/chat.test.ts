import { existsSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getConfig } from "../../src/server/config.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createAdopter, createPet, createShelter, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const DAY = 24 * 60 * 60 * 1000;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082", "hex");

let shelter: CreatedUser;
let adopter: CreatedUser;
let shelterCookie: string;
let adopterCookie: string;

const get = (path: string, as: string) => request(createApp()).get(path).set("Cookie", as);
const send = (conversationId: number, body: object, as: string) =>
  request(createApp()).post(`/api/conversations/${String(conversationId)}/messages`).set("Cookie", as).send(body);
const sendPhoto = (conversationId: number, file: Buffer, as: string) =>
  request(createApp()).post(`/api/conversations/${String(conversationId)}/photos`).set("Cookie", as).attach("photo", file, "foto.png");

/** Opens the pair's conversation the way the app does: the adopter requests a visit (RN-134). */
async function openConversation(adopterId = adopter.id, shelterId = shelter.id): Promise<number> {
  const pet = await createPet({ shelterId, name: "Luna" });
  const slot = await createVisitSlot({ shelterId, startsAt: new Date(Date.now() + 7 * DAY), capacity: 5 });
  const res = await request(createApp()).post("/api/adopter/visits").set("Cookie", await sessionCookie(adopterId)).send({ petId: pet.id, slotId: slot.id });
  expect(res.status).toBe(201);
  const { rows } = await getPool().query<{ id: number }>(`SELECT id FROM "Conversation" WHERE adopter_id = $1 AND shelter_id = $2`, [adopterId, shelterId]);
  return rows[0]?.id ?? 0;
}

async function block(endsAt: Date | null): Promise<void> {
  await getPool().query(`INSERT INTO "Block" (shelter_id, adopter_id, reason, ends_at) VALUES ($1, $2, 'OTHER', $3)`, [shelter.id, adopter.id, endsAt]);
}

async function messageRows(): Promise<{ sender_id: number; body: string | null; attachment_type: string | null; read: boolean }[]> {
  const { rows } = await getPool().query<{ sender_id: number; body: string | null; attachment_type: string | null; read: boolean }>(
    `SELECT sender_id, body, attachment_type, read_at IS NOT NULL AS read FROM "Message" ORDER BY id`,
  );
  return rows;
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter({ name: "Refugio Esperanza" });
  adopter = await createAdopter();
  shelterCookie = await sessionCookie(shelter.id);
  adopterCookie = await sessionCookie(adopter.id);
});

describe("T-29 CU-33 conversations", () => {
  it("RN-133, RN-134, CU-33: the first visit request opens one conversation per pair, which both parties see", async () => {
    const id = await openConversation();
    await openConversation();

    const forAdopter = await get("/api/conversations", adopterCookie);
    const forShelter = await get("/api/conversations", shelterCookie);

    expect(forAdopter.status).toBe(200);
    expect(forAdopter.body.conversations).toEqual([
      { id, otherName: "Refugio Esperanza", lastMessage: null, lastMessageAt: null, unread: 0, canWrite: true },
    ]);
    expect(forShelter.body.conversations).toEqual([expect.objectContaining({ id, otherName: expect.any(String), canWrite: true })]);
    const { rows } = await getPool().query(`SELECT 1 FROM "Conversation"`);
    expect(rows).toHaveLength(1);
  });

  it("CU-33: an adopter with no visit request to a shelter has no conversation with it", async () => {
    const res = await get("/api/conversations", adopterCookie);

    expect(res.body.conversations).toEqual([]);
  });

  it("CU-33: only the two parties can open a conversation; only adopters and shelters use the chat", async () => {
    const id = await openConversation();
    for (const other of [await createAdopter(), await createShelter()]) {
      const cookie = await sessionCookie(other.id);
      expect((await get(`/api/conversations/${String(id)}/messages`, cookie)).status).toBe(404);
      expect((await send(id, { body: "Hola" }, cookie)).status).toBe(404);
    }
    expect((await get("/api/conversations", await sessionCookie((await createAdmin()).id))).status).toBe(403);
    expect((await request(createApp()).get("/api/conversations")).status).toBe(401);
    expect(await messageRows()).toEqual([]);
  });
});

describe("T-29 CU-33 messages", () => {
  it("CU-33, RN-139: both parties send text, and the other one reads it", async () => {
    const id = await openConversation();

    const first = await send(id, { body: "  Hola, ¿puedo llevar a mis hijos a la visita?  " }, adopterCookie);
    const reply = await send(id, { body: "¡Claro!" }, shelterCookie);

    expect(first.status).toBe(201);
    expect(first.body.message).toMatchObject({ mine: true, senderName: expect.any(String), body: "Hola, ¿puedo llevar a mis hijos a la visita?", photoUrl: null });
    expect(reply.status).toBe(201);
    const res = await get(`/api/conversations/${String(id)}/messages`, adopterCookie);
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: { mine: boolean; body: string }) => [m.mine, m.body])).toEqual([
      [true, "Hola, ¿puedo llevar a mis hijos a la visita?"],
      [false, "¡Claro!"],
    ]);
    expect(res.body.conversation).toEqual({ id, otherName: "Refugio Esperanza", canWrite: true, notice: null });
  });

  it("RN-138: opening the conversation records when the other party's messages are read", async () => {
    const id = await openConversation();
    await send(id, { body: "Hola" }, adopterCookie);
    await send(id, { body: "Buenas" }, shelterCookie);

    const list = await get("/api/conversations", shelterCookie);
    expect(list.body.conversations[0]).toMatchObject({ lastMessage: "Buenas", unread: 1 });

    await get(`/api/conversations/${String(id)}/messages`, shelterCookie);

    expect((await messageRows()).map((m) => m.read)).toEqual([true, false]);
    expect((await get("/api/conversations", shelterCookie)).body.conversations[0].unread).toBe(0);
  });

  it("CU-33: polling with ?after returns only the newer messages", async () => {
    const id = await openConversation();
    const first = await send(id, { body: "Uno" }, adopterCookie);
    await send(id, { body: "Dos" }, shelterCookie);

    const res = await get(`/api/conversations/${String(id)}/messages?after=${String(first.body.message.id)}`, adopterCookie);

    expect(res.body.messages.map((m: { body: string }) => m.body)).toEqual(["Dos"]);
  });

  it("CU-33: an empty or too long message is rejected", async () => {
    const id = await openConversation();
    for (const body of [{}, { body: "   " }, { body: "x".repeat(2001) }]) {
      expect((await send(id, body, adopterCookie)).status, JSON.stringify(body).slice(0, 30)).toBe(400);
    }
    expect(await messageRows()).toEqual([]);
  });

  it("RN-139, RN-52: sends a photo, saved under a random name with only its path in the database", async () => {
    const id = await openConversation();

    const res = await sendPhoto(id, PNG, shelterCookie);

    expect(res.status).toBe(201);
    expect(res.body.message).toMatchObject({ mine: true, body: null, photoUrl: expect.stringMatching(/^\/uploads\/[\w-]+\.png$/) });
    expect(await messageRows()).toEqual([{ sender_id: shelter.id, body: null, attachment_type: "IMAGE", read: false }]);
    const url = res.body.message.photoUrl as string;
    expect(existsSync(join(getConfig().uploadsDir, url.slice("/uploads/".length)))).toBe(true);
  });

  it("RN-139: only images are accepted as photos", async () => {
    const id = await openConversation();

    const res = await sendPhoto(id, Buffer.from("no es una imagen"), adopterCookie);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "La foto tiene que ser una imagen JPEG, PNG o WebP." });
    expect(await messageRows()).toEqual([]);
  });
});

describe("T-29 CU-33 conversations that can be read but not written", () => {
  it("RN-136, RN-198, CU-33: with an active block nobody can write, both can read, and both see a fixed notice with the end date", async () => {
    const id = await openConversation();
    await send(id, { body: "Hola" }, adopterCookie);
    await block(new Date(Date.now() + 10 * DAY));

    for (const cookie of [adopterCookie, shelterCookie]) {
      const write = await send(id, { body: "¿Hola?" }, cookie);
      expect(write.status).toBe(409);
      expect(write.body).toEqual({ error: "Mientras dure el bloqueo no se pueden enviar mensajes." });
      expect((await sendPhoto(id, PNG, cookie)).status).toBe(409);

      const read = await get(`/api/conversations/${String(id)}/messages`, cookie);
      expect(read.status).toBe(200);
      expect(read.body.messages).toHaveLength(1);
      expect(read.body.conversation.canWrite).toBe(false);
      expect(read.body.conversation.notice).toMatch(/bloquead.* hasta el \d+ de \w+ de \d{4}/);
    }
    expect((await get("/api/conversations", adopterCookie)).body.conversations[0].canWrite).toBe(false);
    expect(await messageRows()).toHaveLength(1);
  });

  it("RN-198: a permanent block has a notice with no end date; once lifted, they can write again", async () => {
    const id = await openConversation();
    await block(null);

    const read = await get(`/api/conversations/${String(id)}/messages`, adopterCookie);
    expect(read.body.conversation.notice).toMatch(/bloquead/);
    expect(read.body.conversation.notice).not.toMatch(/hasta el/);

    await getPool().query(`UPDATE "Block" SET lifted_at = now(), lifted_by = 'SHELTER'`);
    const after = await get(`/api/conversations/${String(id)}/messages`, adopterCookie);
    expect(after.body.conversation).toMatchObject({ canWrite: true, notice: null });
    expect((await send(id, { body: "Gracias" }, adopterCookie)).status).toBe(201);
  });

  it("RN-13, CU-33: when the other party deleted their account, their messages stay as 'Usuario eliminado' and nobody can write", async () => {
    const id = await openConversation();
    await send(id, { body: "Hola" }, adopterCookie);
    await getPool().query(`UPDATE "App_user" SET deleted_at = now() WHERE id = $1`, [adopter.id]);

    const read = await get(`/api/conversations/${String(id)}/messages`, shelterCookie);
    expect(read.status).toBe(200);
    expect(read.body.conversation).toMatchObject({ otherName: "Usuario eliminado", canWrite: false, notice: expect.stringContaining("eliminado su cuenta") });
    expect(read.body.messages[0]).toMatchObject({ mine: false, senderName: "Usuario eliminado", body: "Hola" });

    const write = await send(id, { body: "¿Sigues ahí?" }, shelterCookie);
    expect(write.status).toBe(409);
    expect(write.body).toEqual({ error: "La otra parte ha eliminado su cuenta: ya no se puede escribir en esta conversación." });
  });
});
