import { getPool } from "../db/pool.js";
import { withTransaction, type Db } from "../db/transaction.js";
import { BadRequestError, ConflictError, NotFoundError } from "../errors.js";
import {
  cancelSlotRow,
  countOccupied,
  insertSlot,
  lockShelterSlot,
  selectShelterSlot,
  selectShelterSlots,
  updateSlotRow,
  voidSlotVisits,
  type VisitSlot,
} from "../models/visit-slots.js";
import { audit } from "./audit.js";
import { createNotification } from "./notifications.js";

export type { VisitSlot };

export interface SlotData {
  startsAt: Date;
  endsAt: Date;
  capacity: number;
}

/** RN-84: not in the past, ends after it starts, at least one place. */
function checkSlot({ startsAt, endsAt, capacity }: SlotData, now = new Date()): void {
  if (startsAt.getTime() <= now.getTime()) throw new BadRequestError("El turno no puede empezar en el pasado.");
  if (endsAt.getTime() <= startsAt.getTime()) throw new BadRequestError("La hora de fin tiene que ser posterior a la de inicio.");
  if (capacity < 1) throw new BadRequestError("El turno tiene que tener al menos una plaza.");
}

/** CU-18: the shelter's calendar. */
export async function listSlots(shelterId: number): Promise<VisitSlot[]> {
  return selectShelterSlots(getPool(), shelterId);
}

async function slotOf(db: Db, shelterId: number, slotId: number): Promise<VisitSlot> {
  const slot = await selectShelterSlot(db, shelterId, slotId);
  if (!slot) throw new Error("slot not found after saving it");
  return slot;
}

/** CU-19, RN-78: publishes a slot in the shelter's calendar. */
export async function createSlot(shelterId: number, data: SlotData): Promise<VisitSlot> {
  checkSlot(data);
  const pool = getPool();
  return slotOf(pool, shelterId, await insertSlot(pool, shelterId, data.startsAt, data.endsAt, data.capacity));
}

/**
 * Locks the shelter's slot for a change. RN-85: a slot that has already started is kept
 * as the history of its visits, so it can be neither deleted nor changed.
 */
async function lockFutureSlot(db: Db, shelterId: number, slotId: number): Promise<{ startsAt: Date; endsAt: Date }> {
  const slot = await lockShelterSlot(db, shelterId, slotId);
  if (!slot) throw new NotFoundError("El turno no existe.");
  if (slot.startsAt.getTime() <= Date.now()) throw new ConflictError("Este turno ya ha pasado: se conserva como historial de sus visitas.");
  return slot;
}

/**
 * RN-111: the slot's active visits are voided (SLOT_CANCELLED) and their adopters are told
 * to choose another slot. RN-208: each change of status is audited.
 */
async function voidVisits(db: Db, shelterId: number, slotId: number, startsAt: Date): Promise<void> {
  for (const visit of await voidSlotVisits(db, slotId)) {
    await createNotification(db, {
      userId: visit.adopterId,
      type: "VISIT_VOIDED_SLOT_CANCELLED",
      params: { petName: visit.petName, startsAt },
      link: { visitId: visit.id },
    });
    await audit(db, {
      actorUserId: shelterId,
      action: "VISIT_VOIDED",
      entityType: "Visit",
      entityId: visit.id,
      details: { before: { status: visit.previousStatus }, after: { status: "VOIDED", voidReason: "SLOT_CANCELLED" } },
    });
  }
}

/**
 * CU-20: changes the date, times or capacity of a future slot. RN-112: the capacity cannot
 * go below the places taken. RN-111: a new date or time voids its visits.
 */
export async function updateSlot(shelterId: number, slotId: number, data: SlotData): Promise<VisitSlot> {
  checkSlot(data);
  return withTransaction(async (client) => {
    const current = await lockFutureSlot(client, shelterId, slotId);
    const moved = current.startsAt.getTime() !== data.startsAt.getTime() || current.endsAt.getTime() !== data.endsAt.getTime();

    if (moved) {
      await voidVisits(client, shelterId, slotId, current.startsAt);
    } else {
      const occupied = await countOccupied(client, slotId);
      if (data.capacity < occupied) {
        throw new ConflictError(`El turno ya tiene ${String(occupied)} plazas ocupadas: la capacidad no puede ser menor.`);
      }
    }
    await updateSlotRow(client, slotId, data.startsAt, data.endsAt, data.capacity);
    return slotOf(client, shelterId, slotId);
  });
}

/** CU-20, RN-85: deletes a future slot (kept as cancelled); RN-111: its visits are voided. */
export async function deleteSlot(shelterId: number, slotId: number): Promise<void> {
  await withTransaction(async (client) => {
    const current = await lockFutureSlot(client, shelterId, slotId);
    await voidVisits(client, shelterId, slotId, current.startsAt);
    await cancelSlotRow(client, slotId);
  });
}
