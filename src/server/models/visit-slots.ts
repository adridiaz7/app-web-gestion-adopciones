import type { Db } from "../db/transaction.js";

export interface SlotVisit {
  id: number;
  petName: string;
  adopterName: string;
  status: string;
}

/** A slot of the shelter's calendar (CU-18). */
export interface VisitSlot {
  id: number;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  /** RN-82: PENDING and CONFIRMED visits take a place. */
  occupied: number;
  /** Its visits, in order of request. */
  visits: SlotVisit[];
}

const SLOT_COLUMNS = `
  vs.id, vs.starts_at AS "startsAt", vs.ends_at AS "endsAt", vs.capacity,
  (SELECT count(*)::int FROM "Visit" v WHERE v.slot_id = vs.id AND v.status IN ('PENDING', 'CONFIRMED')) AS occupied,
  coalesce((SELECT json_agg(json_build_object('id', v.id, 'petName', p.name,
                                              'adopterName', a.first_name || ' ' || a.last_name, 'status', v.status)
                            ORDER BY v.created_at, v.id)
              FROM "Visit" v
              JOIN "Pet" p ON p.id = v.pet_id
              JOIN "Adopter" a ON a.user_id = v.adopter_id
             WHERE v.slot_id = vs.id), '[]'::json) AS visits`;

/** CU-18: the shelter's slots that are not cancelled, in time order. */
export async function selectShelterSlots(db: Db, shelterId: number): Promise<VisitSlot[]> {
  const { rows } = await db.query<VisitSlot>(
    `SELECT ${SLOT_COLUMNS} FROM "Visit_slot" vs
      WHERE vs.shelter_id = $1 AND vs.cancelled_at IS NULL
      ORDER BY vs.starts_at, vs.id`,
    [shelterId],
  );
  return rows;
}

export async function selectShelterSlot(db: Db, shelterId: number, slotId: number): Promise<VisitSlot | null> {
  const { rows } = await db.query<VisitSlot>(
    `SELECT ${SLOT_COLUMNS} FROM "Visit_slot" vs WHERE vs.id = $2 AND vs.shelter_id = $1 AND vs.cancelled_at IS NULL`,
    [shelterId, slotId],
  );
  return rows[0] ?? null;
}

export async function insertSlot(db: Db, shelterId: number, startsAt: Date, endsAt: Date, capacity: number): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO "Visit_slot" (shelter_id, starts_at, ends_at, capacity) VALUES ($1, $2, $3, $4) RETURNING id`,
    [shelterId, startsAt, endsAt, capacity],
  );
  const row = rows[0];
  if (!row) throw new Error("insertSlot: no row returned");
  return row.id;
}

/** Locks a slot of the shelter that is not cancelled, or null. */
export async function lockShelterSlot(
  db: Db,
  shelterId: number,
  slotId: number,
): Promise<{ startsAt: Date; endsAt: Date; capacity: number } | null> {
  const { rows } = await db.query<{ startsAt: Date; endsAt: Date; capacity: number }>(
    `SELECT starts_at AS "startsAt", ends_at AS "endsAt", capacity FROM "Visit_slot"
      WHERE id = $2 AND shelter_id = $1 AND cancelled_at IS NULL
      FOR UPDATE`,
    [shelterId, slotId],
  );
  return rows[0] ?? null;
}

/** RN-82: places taken by PENDING and CONFIRMED visits. */
export async function countOccupied(db: Db, slotId: number): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM "Visit" WHERE slot_id = $1 AND status IN ('PENDING', 'CONFIRMED')`,
    [slotId],
  );
  return rows[0]?.n ?? 0;
}

export async function updateSlotRow(db: Db, slotId: number, startsAt: Date, endsAt: Date, capacity: number): Promise<void> {
  await db.query(`UPDATE "Visit_slot" SET starts_at = $2, ends_at = $3, capacity = $4 WHERE id = $1`, [slotId, startsAt, endsAt, capacity]);
}

/** RN-85: a deleted slot is kept with its cancellation date. */
export async function cancelSlotRow(db: Db, slotId: number): Promise<void> {
  await db.query(`UPDATE "Visit_slot" SET cancelled_at = now() WHERE id = $1`, [slotId]);
}

export interface VoidedVisit {
  id: number;
  adopterId: number;
  petName: string;
  previousStatus: string;
}

/** RN-111: the slot's active visits become VOIDED (SLOT_CANCELLED), in order of request. */
export async function voidSlotVisits(db: Db, slotId: number): Promise<VoidedVisit[]> {
  const { rows } = await db.query<VoidedVisit>(
    `WITH active AS (
       SELECT id, status FROM "Visit" WHERE slot_id = $1 AND status IN ('PENDING', 'CONFIRMED') FOR UPDATE
     )
     UPDATE "Visit" v SET status = 'VOIDED', void_reason = 'SLOT_CANCELLED', voided_at = now()
       FROM active, "Pet" p
      WHERE v.id = active.id AND p.id = v.pet_id
     RETURNING v.id, v.adopter_id AS "adopterId", p.name AS "petName", active.status AS "previousStatus"`,
    [slotId],
  );
  return rows.sort((a, b) => a.id - b.id);
}
