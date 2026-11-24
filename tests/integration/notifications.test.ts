import { beforeEach, describe, expect, it } from "vitest";
import { getPool } from "../../src/server/db/pool.js";
import { withTransaction } from "../../src/server/db/transaction.js";
import { createNotification } from "../../src/server/services/notifications.js";
import { truncateAll } from "../helpers/db.js";
import { createAdopter, createPet, createShelter, createVisit, createVisitSlot } from "../helpers/factories.js";

const startsAt = new Date("2026-12-03T09:30:00Z");

interface NotificationRow {
  user_id: number;
  type: string;
  title: string;
  body: string;
  visit_id: number | null;
  adoption_id: number | null;
  pet_id: number | null;
  incident_id: number | null;
  read_at: Date | null;
}

async function notificationRows(): Promise<NotificationRow[]> {
  const { rows } = await getPool().query<NotificationRow>(
    `SELECT user_id, type, title, body, visit_id, adoption_id, pet_id, incident_id, read_at
       FROM "Notification" ORDER BY id`,
  );
  return rows;
}

async function visitScenario() {
  const adopter = await createAdopter();
  const shelter = await createShelter();
  const pet = await createPet({ shelterId: shelter.id, name: "Txuri" });
  const slot = await createVisitSlot({ shelterId: shelter.id, startsAt });
  const visit = await createVisit({ adopterId: adopter.id, shelterId: shelter.id, petId: pet.id, slotId: slot.id });
  return { adopter, shelter, pet, visit };
}

describe("T-03 createNotification()", () => {
  beforeEach(truncateAll);

  it("RN-143, RN-142: stores an unread notification with the template texts, linked to its visit", async () => {
    const { adopter, visit } = await visitScenario();

    const created = await createNotification(getPool(), {
      userId: adopter.id,
      type: "VISIT_CONFIRMED",
      params: { petName: "Txuri", startsAt },
      link: { visitId: visit.id },
    });

    expect(created.id).toBeGreaterThan(0);
    expect(await notificationRows()).toEqual([
      {
        user_id: adopter.id,
        type: "VISIT_CONFIRMED",
        title: "Visita confirmada",
        body: "La protectora ha confirmado tu visita para conocer a Txuri el 3 de diciembre de 2026 a las 10:30.",
        visit_id: visit.id,
        adoption_id: null,
        pet_id: null,
        incident_id: null,
        read_at: null,
      },
    ]);
  });

  it("RN-142: a notification can have no linked item", async () => {
    const adopter = await createAdopter();

    await createNotification(getPool(), {
      userId: adopter.id,
      type: "VISIT_REJECTED",
      params: { petName: "Txuri", startsAt, reason: null },
    });

    const [row] = await notificationRows();
    expect(row).toMatchObject({ visit_id: null, adoption_id: null, pet_id: null, incident_id: null });
  });

  it("RN-141: shelters receive notifications too", async () => {
    const shelter = await createShelter();

    await createNotification(getPool(), {
      userId: shelter.id,
      type: "VISIT_CONFIRMED",
      params: { petName: "Txuri", startsAt },
    });

    expect((await notificationRows()).map((n) => n.user_id)).toEqual([shelter.id]);
  });

  it("RN-171: is written inside the caller's transaction and disappears if it rolls back", async () => {
    const adopter = await createAdopter();

    await expect(
      withTransaction(async (client) => {
        await createNotification(client, {
          userId: adopter.id,
          type: "VISIT_CONFIRMED",
          params: { petName: "Txuri", startsAt },
        });
        throw new Error("the action failed");
      }),
    ).rejects.toThrow("the action failed");

    expect(await notificationRows()).toEqual([]);
  });
});
