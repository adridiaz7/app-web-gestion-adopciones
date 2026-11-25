import type { Db } from "../db/transaction.js";
import { visibleShelterCondition } from "./gallery.js";

/** The pet a visit is requested for, with what CU-23 needs to check about it and its shelter. */
export interface PetForRequest {
  shelterId: number;
  shelterName: string;
  status: string;
  /** RN-23: validated, not suspended and not deleted (the block is checked apart, RN-88). */
  shelterVisible: boolean;
}

/** The pet, locked so its status does not change while the visit is requested, or null. */
export async function lockPetForRequest(db: Db, petId: number): Promise<PetForRequest | null> {
  const { rows } = await db.query<PetForRequest>(
    `SELECT p.shelter_id AS "shelterId", s.name AS "shelterName", p.status,
            (${visibleShelterCondition("NULL")}) AS "shelterVisible"
       FROM "Pet" p
       JOIN "Shelter"  s  ON s.user_id = p.shelter_id
       JOIN "App_user" su ON su.id = s.user_id
      WHERE p.id = $1
        FOR SHARE OF p`,
    [petId],
  );
  return rows[0] ?? null;
}

/** RN-89: whether the adopter has a NO_SHOW visit at the shelter. */
export async function hasNoShow(db: Db, adopterId: number, shelterId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM "Visit" WHERE adopter_id = $1 AND shelter_id = $2 AND status = 'NO_SHOW' LIMIT 1`,
    [adopterId, shelterId],
  );
  return rows.length > 0;
}

/** RN-81: whether the pet already has an active (PENDING or CONFIRMED) visit in the slot. */
export async function petHasActiveVisit(db: Db, petId: number, slotId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM "Visit" WHERE pet_id = $1 AND slot_id = $2 AND status IN ('PENDING', 'CONFIRMED') LIMIT 1`,
    [petId, slotId],
  );
  return rows.length > 0;
}

/**
 * RN-90, RN-91, RN-92: when each of the adopter's CONFIRMED and COMPLETED visits at the shelter
 * that still count for the quota (slot less than `windowMonths` ago) stops counting, soonest first.
 */
export async function selectQuotaVisitEnds(db: Db, adopterId: number, shelterId: number, windowMonths: number): Promise<Date[]> {
  const { rows } = await db.query<{ countsUntil: Date }>(
    `SELECT vs.starts_at + make_interval(months => $3) AS "countsUntil"
       FROM "Visit" v JOIN "Visit_slot" vs ON vs.id = v.slot_id
      WHERE v.adopter_id = $1 AND v.shelter_id = $2 AND v.status IN ('CONFIRMED', 'COMPLETED')
        AND vs.starts_at > now() - make_interval(months => $3)
      ORDER BY vs.starts_at`,
    [adopterId, shelterId, windowMonths],
  );
  return rows.map((row) => row.countsUntil);
}

export async function insertVisit(db: Db, adopterId: number, shelterId: number, petId: number, slotId: number): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO "Visit" (adopter_id, shelter_id, pet_id, slot_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [adopterId, shelterId, petId, slotId],
  );
  const row = rows[0];
  if (!row) throw new Error("insertVisit: no row returned");
  return row.id;
}

/** RN-133, RN-134: opens the pair's conversation if it does not exist yet. */
export async function ensureConversation(db: Db, adopterId: number, shelterId: number): Promise<void> {
  await db.query(
    `INSERT INTO "Conversation" (adopter_id, shelter_id) VALUES ($1, $2) ON CONFLICT (adopter_id, shelter_id) DO NOTHING`,
    [adopterId, shelterId],
  );
}

/** A visit as the adopter sees it after requesting it. RN-193: it takes place at the shelter's address. */
export interface RequestedVisit {
  id: number;
  status: string;
  petId: number;
  petName: string;
  slotId: number;
  startsAt: Date;
  endsAt: Date;
  shelterName: string;
  shelterAddress: string;
}

export async function selectRequestedVisit(db: Db, visitId: number): Promise<RequestedVisit | null> {
  const { rows } = await db.query<RequestedVisit>(
    `SELECT v.id, v.status, v.pet_id AS "petId", p.name AS "petName", v.slot_id AS "slotId",
            vs.starts_at AS "startsAt", vs.ends_at AS "endsAt", s.name AS "shelterName",
            s.address || ', ' || s.locality || ' (' || pv.name || ')' AS "shelterAddress"
       FROM "Visit" v
       JOIN "Pet"        p  ON p.id = v.pet_id
       JOIN "Visit_slot" vs ON vs.id = v.slot_id
       JOIN "Shelter"    s  ON s.user_id = v.shelter_id
       JOIN "Province"   pv ON pv.id = s.province_id
      WHERE v.id = $1`,
    [visitId],
  );
  return rows[0] ?? null;
}

/** A slot the adopter can choose (RN-194). */
export interface AvailableSlot {
  id: number;
  startsAt: Date;
  endsAt: Date;
  freePlaces: number;
}

/**
 * RN-194: the shelter's slots, not cancelled, starting `minNoticeHours` or more from now, with
 * free places (RN-82) and with no active visit of the pet (RN-81), in time order.
 */
export async function selectAvailableSlots(db: Db, shelterId: number, petId: number, minNoticeHours: number): Promise<AvailableSlot[]> {
  const { rows } = await db.query<AvailableSlot>(
    `SELECT vs.id, vs.starts_at AS "startsAt", vs.ends_at AS "endsAt", vs.capacity - occ.n AS "freePlaces"
       FROM "Visit_slot" vs
       CROSS JOIN LATERAL (SELECT count(*)::int AS n FROM "Visit" v
                            WHERE v.slot_id = vs.id AND v.status IN ('PENDING', 'CONFIRMED')) occ
      WHERE vs.shelter_id = $1 AND vs.cancelled_at IS NULL
        AND vs.starts_at >= now() + make_interval(hours => $3)
        AND occ.n < vs.capacity
        AND NOT EXISTS (SELECT 1 FROM "Visit" v
                         WHERE v.slot_id = vs.id AND v.pet_id = $2 AND v.status IN ('PENDING', 'CONFIRMED'))
      ORDER BY vs.starts_at, vs.id`,
    [shelterId, petId, minNoticeHours],
  );
  return rows;
}

export type VisitStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED" | "EXPIRED" | "VOIDED" | "COMPLETED" | "NO_SHOW";

/** A visit locked for a change of status, with what CU-24 and CU-25 need. */
export interface VisitForChange {
  id: number;
  adopterId: number;
  shelterId: number;
  status: VisitStatus;
  createdAt: Date;
  petName: string;
  startsAt: Date;
}

/** The visit of that adopter or shelter (`owner`), locked, or null if it is not theirs. */
export async function lockVisit(db: Db, visitId: number, owner: { adopterId: number } | { shelterId: number }): Promise<VisitForChange | null> {
  const [column, ownerId] = "adopterId" in owner ? ["adopter_id", owner.adopterId] : ["shelter_id", owner.shelterId];
  const { rows } = await db.query<VisitForChange>(
    `SELECT v.id, v.adopter_id AS "adopterId", v.shelter_id AS "shelterId", v.status, v.created_at AS "createdAt",
            p.name AS "petName", vs.starts_at AS "startsAt"
       FROM "Visit" v
       JOIN "Pet" p ON p.id = v.pet_id
       JOIN "Visit_slot" vs ON vs.id = v.slot_id
      WHERE v.id = $1 AND v.${column} = $2
        FOR UPDATE OF v`,
    [visitId, ownerId],
  );
  return rows[0] ?? null;
}

export async function markVisitConfirmed(db: Db, visitId: number): Promise<void> {
  await db.query(`UPDATE "Visit" SET status = 'CONFIRMED', responded_at = now() WHERE id = $1`, [visitId]);
}

/** RN-96: the reason is optional. */
export async function markVisitRejected(db: Db, visitId: number, reason: string | null): Promise<void> {
  await db.query(`UPDATE "Visit" SET status = 'REJECTED', responded_at = now(), rejection_reason = $2 WHERE id = $1`, [visitId, reason]);
}

/** RN-101: who cancels is recorded. */
export async function markVisitCancelled(db: Db, visitId: number, cancelledBy: "ADOPTER" | "SHELTER"): Promise<void> {
  await db.query(`UPDATE "Visit" SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = now() WHERE id = $1`, [visitId, cancelledBy]);
}

/** CU-21: a visit as the adopter sees it in their list. */
export interface AdopterVisit {
  id: number;
  status: VisitStatus;
  petId: number;
  petName: string;
  photoUrl: string | null;
  shelterId: number;
  shelterName: string;
  startsAt: Date;
  endsAt: Date;
  rejectionReason: string | null;
  cancelledBy: "ADOPTER" | "SHELTER" | null;
  voidReason: string | null;
}

/** CU-21: all the adopter's visits, by slot time. */
export async function selectAdopterVisits(db: Db, adopterId: number): Promise<AdopterVisit[]> {
  const { rows } = await db.query<AdopterVisit>(
    `SELECT v.id, v.status, v.pet_id AS "petId", p.name AS "petName",
            (SELECT ph.path FROM "Pet_photo" ph WHERE ph.pet_id = p.id ORDER BY ph.position LIMIT 1) AS "photoUrl",
            v.shelter_id AS "shelterId", s.name AS "shelterName", vs.starts_at AS "startsAt", vs.ends_at AS "endsAt",
            v.rejection_reason AS "rejectionReason", v.cancelled_by AS "cancelledBy", v.void_reason AS "voidReason"
       FROM "Visit" v
       JOIN "Pet"        p  ON p.id = v.pet_id
       JOIN "Visit_slot" vs ON vs.id = v.slot_id
       JOIN "Shelter"    s  ON s.user_id = v.shelter_id
      WHERE v.adopter_id = $1
      ORDER BY vs.starts_at, v.id`,
    [adopterId],
  );
  return rows;
}

/** CU-21, RN-89 to RN-91: the quota at each shelter where the adopter has visits. */
export interface ShelterQuotaRow {
  shelterId: number;
  shelterName: string;
  /** When each visit that still counts stops counting, soonest first. */
  countsUntil: Date[];
  noShow: boolean;
}

export async function selectAdopterQuotas(db: Db, adopterId: number, windowMonths: number): Promise<ShelterQuotaRow[]> {
  const { rows } = await db.query<{ shelterId: number; shelterName: string; countsUntil: string[]; noShow: boolean }>(
    `SELECT v.shelter_id AS "shelterId", s.name AS "shelterName",
            coalesce(array_agg(vs.starts_at + make_interval(months => $2) ORDER BY vs.starts_at)
                       FILTER (WHERE v.status IN ('CONFIRMED', 'COMPLETED')
                                 AND vs.starts_at > now() - make_interval(months => $2)), '{}') AS "countsUntil",
            bool_or(v.status = 'NO_SHOW') AS "noShow"
       FROM "Visit" v
       JOIN "Visit_slot" vs ON vs.id = v.slot_id
       JOIN "Shelter"    s  ON s.user_id = v.shelter_id
      WHERE v.adopter_id = $1
      GROUP BY v.shelter_id, s.name
      ORDER BY s.name, v.shelter_id`,
    [adopterId, windowMonths],
  );
  return rows.map((row) => ({ ...row, countsUntil: row.countsUntil.map((value) => new Date(value)) }));
}

/** CU-22: a visit in the shelter's inbox. */
export interface InboxVisit {
  id: number;
  status: VisitStatus;
  petId: number;
  petName: string;
  adopterId: number;
  adopterName: string;
  startsAt: Date;
  endsAt: Date;
  /** RN-94: only for pending requests. */
  respondBy: Date | null;
}

const INBOX_COLUMNS = `
  v.id, v.status, v.pet_id AS "petId", p.name AS "petName", v.adopter_id AS "adopterId",
  a.first_name || ' ' || a.last_name AS "adopterName", vs.starts_at AS "startsAt", vs.ends_at AS "endsAt"`;
const INBOX_FROM = `
  FROM "Visit" v
  JOIN "Pet"        p  ON p.id = v.pet_id
  JOIN "Visit_slot" vs ON vs.id = v.slot_id
  JOIN "Adopter"    a  ON a.user_id = v.adopter_id`;

/** CU-22, RN-94: pending requests that can still be answered, the oldest request first. */
export async function selectPendingRequests(db: Db, shelterId: number, deadlineHours: number): Promise<InboxVisit[]> {
  const { rows } = await db.query<InboxVisit>(
    `SELECT ${INBOX_COLUMNS}, v.created_at + make_interval(hours => $2) AS "respondBy"
       ${INBOX_FROM}
      WHERE v.shelter_id = $1 AND v.status = 'PENDING' AND v.created_at + make_interval(hours => $2) > now()
      ORDER BY v.created_at, v.id`,
    [shelterId, deadlineHours],
  );
  return rows;
}

/** CU-22: confirmed visits that have not started yet, soonest first. */
export async function selectUpcomingVisits(db: Db, shelterId: number): Promise<InboxVisit[]> {
  const { rows } = await db.query<InboxVisit>(
    `SELECT ${INBOX_COLUMNS}, NULL::timestamptz AS "respondBy"
       ${INBOX_FROM}
      WHERE v.shelter_id = $1 AND v.status = 'CONFIRMED' AND vs.starts_at > now()
      ORDER BY vs.starts_at, v.id`,
    [shelterId],
  );
  return rows;
}
