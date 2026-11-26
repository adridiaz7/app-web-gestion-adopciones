import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { getPool } from "../../src/server/db/pool.js";
import { sessionCookie } from "../helpers/auth.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, createVisitSlot, type CreatedUser } from "../helpers/factories.js";

const DAY = 24 * 60 * 60 * 1000;

let shelter: CreatedUser;
let adopter: CreatedUser;
let conversationId: number;

const notice = async (userId: number): Promise<string | null> => {
  const res = await request(createApp())
    .get(`/api/conversations/${String(conversationId)}/messages`)
    .set("Cookie", await sessionCookie(userId));
  expect(res.status).toBe(200);
  return res.body.conversation.notice as string | null;
};

async function block(endsAt: Date | null): Promise<void> {
  await getPool().query(`INSERT INTO "Block" (shelter_id, adopter_id, reason, ends_at) VALUES ($1, $2, 'OTHER', $3)`, [shelter.id, adopter.id, endsAt]);
}

beforeEach(async () => {
  await truncateAll();
  shelter = await createShelter({ name: "Refugio Esperanza" });
  adopter = await createAdopter();
  const pet = await createPet({ shelterId: shelter.id, name: "Luna" });
  const slot = await createVisitSlot({ shelterId: shelter.id, startsAt: new Date(Date.now() + 7 * DAY), capacity: 5 });
  const res = await request(createApp()).post("/api/adopter/visits").set("Cookie", await sessionCookie(adopter.id)).send({ petId: pet.id, slotId: slot.id });
  expect(res.status).toBe(201);
  const { rows } = await getPool().query<{ id: number }>(`SELECT id FROM "Conversation"`);
  conversationId = rows[0]?.id ?? 0;
});

describe("T-51 RN-149, RN-198 neutral block notice for the adopter in the chat", () => {
  it("RN-149, RN-198: during a temporary block the adopter sees the neutral text with the shelter's name and the end date", async () => {
    await block(new Date(Date.now() + 10 * DAY));

    const text = await notice(adopter.id);

    expect(text).toMatch(/^La protectora Refugio Esperanza ha restringido tu acceso hasta el \d+ de \w+ de \d{4}\./);
    expect(text).not.toMatch(/bloque/i);
  });

  it("RN-149, RN-198: during a permanent block the adopter sees the neutral text with no end date", async () => {
    await block(null);

    const text = await notice(adopter.id);

    expect(text).toMatch(/^La protectora Refugio Esperanza ha restringido tu acceso\./);
    expect(text).not.toMatch(/bloque|hasta el/i);
  });

  it("RN-198: the shelter still sees that it has blocked the adopter, with the end date", async () => {
    await block(new Date(Date.now() + 10 * DAY));

    expect(await notice(shelter.id)).toMatch(/^Has bloqueado a este adoptante hasta el \d+ de \w+ de \d{4}\./);
  });
});
