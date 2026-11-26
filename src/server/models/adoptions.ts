import type { Db } from "../db/transaction.js";
import type { Household } from "./adopters.js";

/** An adoption whose status a cascade has just changed. */
export interface ChangedAdoption {
  id: number;
  petId: number;
  petName: string;
}

/** RN-103: the adopter's PENDING adoptions of the shelter's pets become VOIDED with that reason. */
export async function voidPendingAdoptions(db: Db, adopterId: number, shelterId: number, reason: "NO_SHOW"): Promise<ChangedAdoption[]> {
  const { rows } = await db.query<ChangedAdoption>(
    `UPDATE "Adoption" a SET status = 'VOIDED', void_reason = $3, voided_at = now()
       FROM "Pet" p
      WHERE p.id = a.pet_id AND p.shelter_id = $2 AND a.adopter_id = $1 AND a.status = 'PENDING'
     RETURNING a.id, a.pet_id AS "petId", p.name AS "petName"`,
    [adopterId, shelterId, reason],
  );
  return rows.sort((a, b) => a.id - b.id);
}

/** RN-103: the adopter's APPROVED adoptions of the shelter's pets are cancelled by the system. */
export async function cancelApprovedAdoptionsBySystem(db: Db, adopterId: number, shelterId: number): Promise<ChangedAdoption[]> {
  const { rows } = await db.query<ChangedAdoption>(
    `UPDATE "Adoption" a SET status = 'CANCELLED', cancelled_by = 'SYSTEM', cancelled_at = now()
       FROM "Pet" p
      WHERE p.id = a.pet_id AND p.shelter_id = $2 AND a.adopter_id = $1 AND a.status = 'APPROVED'
     RETURNING a.id, a.pet_id AS "petId", p.name AS "petName"`,
    [adopterId, shelterId],
  );
  return rows.sort((a, b) => a.id - b.id);
}

/** A RESERVED pet becomes AVAILABLE again. Returns whether it changed. */
export async function releaseReservedPet(db: Db, petId: number): Promise<boolean> {
  const { rowCount } = await db.query(`UPDATE "Pet" SET status = 'AVAILABLE', updated_at = now() WHERE id = $1 AND status = 'RESERVED'`, [petId]);
  return rowCount === 1;
}

/** The adopters whose adoption of the pet was NOT_SELECTED. */
export async function selectNotSelectedAdopters(db: Db, petId: number): Promise<number[]> {
  const { rows } = await db.query<{ adopterId: number }>(
    `SELECT DISTINCT adopter_id AS "adopterId" FROM "Adoption" WHERE pet_id = $1 AND status = 'NOT_SELECTED' ORDER BY 1`,
    [petId],
  );
  return rows.map((row) => row.adopterId);
}

/** An adoption voided by a cascade, with its adopter. */
export interface VoidedAdoption extends ChangedAdoption {
  adopterId: number;
}

/** RN-65: the pet's PENDING adoptions become VOIDED with that reason. */
export async function voidPetPendingAdoptions(db: Db, petId: number, reason: "PET_UNLISTED"): Promise<VoidedAdoption[]> {
  const { rows } = await db.query<VoidedAdoption>(
    `UPDATE "Adoption" a SET status = 'VOIDED', void_reason = $2, voided_at = now()
       FROM "Pet" p
      WHERE p.id = a.pet_id AND a.pet_id = $1 AND a.status = 'PENDING'
     RETURNING a.id, a.pet_id AS "petId", p.name AS "petName", a.adopter_id AS "adopterId"`,
    [petId, reason],
  );
  return rows.sort((a, b) => a.id - b.id);
}

/**
 * RN-67: the adopters whose visits or adoptions of the pet were voided by its current
 * unlisting (voided for PET_UNLISTED since `unlistedAt`), each once, in order of first void.
 */
export async function selectAdoptersVoidedByUnlisting(db: Db, petId: number, unlistedAt: Date): Promise<number[]> {
  const { rows } = await db.query<{ adopterId: number }>(
    `SELECT adopter_id AS "adopterId" FROM (
       SELECT adopter_id, id, 1 AS kind FROM "Visit"
        WHERE pet_id = $1 AND status = 'VOIDED' AND void_reason = 'PET_UNLISTED' AND voided_at >= $2
       UNION ALL
       SELECT adopter_id, id, 2 AS kind FROM "Adoption"
        WHERE pet_id = $1 AND status = 'VOIDED' AND void_reason = 'PET_UNLISTED' AND voided_at >= $2
     ) voided
     GROUP BY adopter_id
     ORDER BY min(kind), min(id)`,
    [petId, unlistedAt],
  );
  return rows.map((row) => row.adopterId);
}

/** RN-119: whether the adopter has an open (PENDING or APPROVED) adoption of the pet. */
export async function hasOpenAdoption(db: Db, adopterId: number, petId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM "Adoption" WHERE adopter_id = $1 AND pet_id = $2 AND status IN ('PENDING', 'APPROVED') LIMIT 1`,
    [adopterId, petId],
  );
  return rows.length > 0;
}

/** RN-113, RN-116: the adopter's most recent COMPLETED visit to the pet, with the slot's start. */
export async function selectLatestCompletedVisit(
  db: Db,
  adopterId: number,
  petId: number,
  validityMonths: number,
): Promise<{ id: number; stillValid: boolean } | null> {
  // RN-116: "1 month" as Postgres counts it (the last day of a shorter month), like the quota of RN-91.
  const { rows } = await db.query<{ id: number; stillValid: boolean }>(
    `SELECT v.id, vs.starts_at + make_interval(months => $3) >= now() AS "stillValid"
       FROM "Visit" v JOIN "Visit_slot" vs ON vs.id = v.slot_id
      WHERE v.adopter_id = $1 AND v.pet_id = $2 AND v.status = 'COMPLETED'
      ORDER BY vs.starts_at DESC, v.id DESC
      LIMIT 1`,
    [adopterId, petId, validityMonths],
  );
  return rows[0] ?? null;
}

/** RN-114, RN-207: a PENDING adoption linked to the visit that enables it, with the answers. */
export async function insertAdoption(db: Db, adopterId: number, petId: number, visitId: number, answers: object): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO "Adoption" (adopter_id, pet_id, visit_id, questionnaire_answers) VALUES ($1, $2, $3, $4) RETURNING id`,
    [adopterId, petId, visitId, JSON.stringify(answers)],
  );
  const row = rows[0];
  if (!row) throw new Error("insertAdoption: no row returned");
  return row.id;
}

/** CU-28: a pending request with the candidate's personal and household data (RN-27) and answers (RN-207). */
export interface CandidateRow {
  adoptionId: number;
  adopterId: number;
  name: string;
  email: string;
  phone: string;
  provinceName: string;
  locality: string;
  household: Household;
  answers: { reason?: string; canAffordCosts?: boolean };
  visitedAt: Date;
  requestedAt: Date;
}

/** CU-28, RN-121: the pet's PENDING adoptions, oldest request first. */
export async function selectCandidates(db: Db, petId: number): Promise<CandidateRow[]> {
  const { rows } = await db.query<CandidateRow>(
    `SELECT ad.id AS "adoptionId", ad.adopter_id AS "adopterId", a.first_name || ' ' || a.last_name AS name,
            u.email, a.phone, pv.name AS "provinceName", a.locality,
            json_build_object('housingType', a.housing_type, 'hasOutdoorSpace', a.has_outdoor_space,
                              'housingTenure', a.housing_tenure, 'householdMembers', a.household_members,
                              'hasChildren', a.has_children, 'hasOtherPets', a.has_other_pets,
                              'otherPetsDescription', a.other_pets_description, 'hasPetExperience', a.has_pet_experience,
                              'hoursAlonePerDay', a.hours_alone_per_day) AS household,
            ad.questionnaire_answers AS answers, vs.starts_at AS "visitedAt", ad.created_at AS "requestedAt"
       FROM "Adoption" ad
       JOIN "Adopter"    a  ON a.user_id = ad.adopter_id
       JOIN "App_user"   u  ON u.id = ad.adopter_id
       JOIN "Province"   pv ON pv.id = a.province_id
       JOIN "Visit"      v  ON v.id = ad.visit_id
       JOIN "Visit_slot" vs ON vs.id = v.slot_id
      WHERE ad.pet_id = $1 AND ad.status = 'PENDING'
      ORDER BY ad.created_at, ad.id`,
    [petId],
  );
  return rows;
}

/** An adoption of one of the shelter's pets, locked, with its pet locked too. */
export interface AdoptionForDecision {
  id: number;
  adopterId: number;
  petId: number;
  petName: string;
  status: string;
}

export async function lockShelterAdoption(db: Db, shelterId: number, adoptionId: number): Promise<AdoptionForDecision | null> {
  const { rows } = await db.query<AdoptionForDecision>(
    `SELECT ad.id, ad.adopter_id AS "adopterId", ad.pet_id AS "petId", p.name AS "petName", ad.status
       FROM "Adoption" ad JOIN "Pet" p ON p.id = ad.pet_id
      WHERE ad.id = $1 AND p.shelter_id = $2
        FOR UPDATE OF ad, p`,
    [adoptionId, shelterId],
  );
  return rows[0] ?? null;
}

/** RN-125: whether the pet already has an APPROVED or COMPLETED adoption. */
export async function petHasActiveAdoption(db: Db, petId: number): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM "Adoption" WHERE pet_id = $1 AND status IN ('APPROVED', 'COMPLETED') LIMIT 1`, [petId]);
  return rows.length > 0;
}

export async function markAdoptionApproved(db: Db, adoptionId: number): Promise<void> {
  await db.query(`UPDATE "Adoption" SET status = 'APPROVED', decided_at = now() WHERE id = $1`, [adoptionId]);
}

/** RN-123: the reason is required. */
export async function markAdoptionRejected(db: Db, adoptionId: number, reason: string): Promise<void> {
  await db.query(`UPDATE "Adoption" SET status = 'REJECTED', rejection_reason = $2, decided_at = now() WHERE id = $1`, [adoptionId, reason]);
}

/** RN-124: the pet's other PENDING adoptions become NOT_SELECTED. */
export async function markOthersNotSelected(db: Db, petId: number, approvedId: number): Promise<VoidedAdoption[]> {
  const { rows } = await db.query<VoidedAdoption>(
    `UPDATE "Adoption" a SET status = 'NOT_SELECTED', decided_at = now()
       FROM "Pet" p
      WHERE p.id = a.pet_id AND a.pet_id = $1 AND a.id <> $2 AND a.status = 'PENDING'
     RETURNING a.id, a.pet_id AS "petId", p.name AS "petName", a.adopter_id AS "adopterId"`,
    [petId, approvedId],
  );
  return rows.sort((a, b) => a.id - b.id);
}

/** RN-124: the pet becomes RESERVED. */
export async function reservePet(db: Db, petId: number): Promise<void> {
  await db.query(`UPDATE "Pet" SET status = 'RESERVED', updated_at = now() WHERE id = $1`, [petId]);
}

/** An adoption locked for closing it (CU-30 to CU-32), with its pet locked too. */
export interface AdoptionToClose {
  id: number;
  adopterId: number;
  shelterId: number;
  petId: number;
  petName: string;
  status: string;
}

/** The adoption, if it is the adopter's or of one of the shelter's pets. */
export async function lockAdoptionToClose(db: Db, adoptionId: number, owner: { adopterId: number } | { shelterId: number }): Promise<AdoptionToClose | null> {
  const [column, ownerId] = "adopterId" in owner ? ["ad.adopter_id", owner.adopterId] : ["p.shelter_id", owner.shelterId];
  const { rows } = await db.query<AdoptionToClose>(
    `SELECT ad.id, ad.adopter_id AS "adopterId", p.shelter_id AS "shelterId", ad.pet_id AS "petId", p.name AS "petName", ad.status
       FROM "Adoption" ad JOIN "Pet" p ON p.id = ad.pet_id
      WHERE ad.id = $1 AND ${column} = $2
        FOR UPDATE OF ad, p`,
    [adoptionId, ownerId],
  );
  return rows[0] ?? null;
}

/** RN-129: who cancels and why are recorded. */
export async function markAdoptionCancelled(db: Db, adoptionId: number, cancelledBy: "ADOPTER" | "SHELTER", reason: string): Promise<void> {
  await db.query(
    `UPDATE "Adoption" SET status = 'CANCELLED', cancelled_by = $2, cancellation_reason = $3, cancelled_at = now() WHERE id = $1`,
    [adoptionId, cancelledBy, reason],
  );
}

/** RN-126: completed, with the delivery date. */
export async function markAdoptionCompleted(db: Db, adoptionId: number): Promise<void> {
  await db.query(`UPDATE "Adoption" SET status = 'COMPLETED', delivered_at = now() WHERE id = $1`, [adoptionId]);
}

/** RN-131: returned, with the date and the reason. */
export async function markAdoptionReturned(db: Db, adoptionId: number, reason: string): Promise<void> {
  await db.query(`UPDATE "Adoption" SET status = 'RETURNED', returned_at = now(), return_reason = $2 WHERE id = $1`, [adoptionId, reason]);
}

/** RN-126, RN-131: the pet's new status. */
export async function setPetStatus(db: Db, petId: number, status: "ADOPTED" | "AVAILABLE"): Promise<void> {
  await db.query(`UPDATE "Pet" SET status = $2, updated_at = now() WHERE id = $1`, [petId, status]);
}

/** CU-21: an adoption as the adopter sees it in their list. */
export interface AdopterAdoption {
  id: number;
  status: string;
  petId: number;
  petName: string;
  shelterName: string;
  requestedAt: Date;
}

export async function selectAdopterAdoptions(db: Db, adopterId: number): Promise<AdopterAdoption[]> {
  const { rows } = await db.query<AdopterAdoption>(
    `SELECT ad.id, ad.status, ad.pet_id AS "petId", p.name AS "petName", s.name AS "shelterName", ad.created_at AS "requestedAt"
       FROM "Adoption" ad
       JOIN "Pet"     p ON p.id = ad.pet_id
       JOIN "Shelter" s ON s.user_id = p.shelter_id
      WHERE ad.adopter_id = $1
      ORDER BY ad.created_at DESC, ad.id DESC`,
    [adopterId],
  );
  return rows;
}

/** CU-22: an approved adoption pending delivery, or a completed one, of the shelter. */
export interface ShelterAdoption {
  id: number;
  status: string;
  petId: number;
  petName: string;
  adopterId: number;
  adopterName: string;
  deliveredAt: Date | null;
}

export async function selectShelterAdoptions(db: Db, shelterId: number): Promise<ShelterAdoption[]> {
  const { rows } = await db.query<ShelterAdoption>(
    `SELECT ad.id, ad.status, ad.pet_id AS "petId", p.name AS "petName", ad.adopter_id AS "adopterId",
            a.first_name || ' ' || a.last_name AS "adopterName", ad.delivered_at AS "deliveredAt"
       FROM "Adoption" ad
       JOIN "Pet"     p ON p.id = ad.pet_id
       JOIN "Adopter" a ON a.user_id = ad.adopter_id
      WHERE p.shelter_id = $1 AND ad.status IN ('APPROVED', 'COMPLETED')
      ORDER BY ad.status, ad.decided_at, ad.id`,
    [shelterId],
  );
  return rows;
}

/** An adoption a reminder or an alert is about (CU-47, CU-48). */
export interface RemindedAdoption {
  id: number;
  shelterId: number;
  shelterName: string;
  petName: string;
  adopterName: string;
}

const REMINDED_ADOPTION = `a.id, p.shelter_id AS "shelterId", s.name AS "shelterName", p.name AS "petName",
               ad.first_name || ' ' || ad.last_name AS "adopterName"`;

/**
 * RN-122, CU-47: marks as reminded the PENDING adoptions whose request, or last reminder,
 * is at least `intervalDays` old, and returns them. Rows being changed by another
 * transaction are skipped (they will be picked up next time).
 */
export async function markDuePendingReminders(db: Db, intervalDays: number): Promise<RemindedAdoption[]> {
  const { rows } = await db.query<RemindedAdoption>(
    `WITH due AS (
       SELECT id FROM "Adoption"
        WHERE status = 'PENDING'
          AND COALESCE(last_pending_reminder_at, created_at) <= now() - make_interval(days => $1)
          FOR UPDATE SKIP LOCKED
     )
     UPDATE "Adoption" a SET last_pending_reminder_at = now()
       FROM due, "Pet" p, "Shelter" s, "Adopter" ad
      WHERE a.id = due.id AND p.id = a.pet_id AND s.user_id = p.shelter_id AND ad.user_id = a.adopter_id
     RETURNING ${REMINDED_ADOPTION}`,
    [intervalDays],
  );
  return rows.sort((x, y) => x.id - y.id);
}

/** RN-127, CU-48: the same for APPROVED adoptions without handover, counting from the approval. */
export async function markDueHandoverReminders(db: Db, intervalDays: number): Promise<RemindedAdoption[]> {
  const { rows } = await db.query<RemindedAdoption>(
    `WITH due AS (
       SELECT id FROM "Adoption"
        WHERE status = 'APPROVED' AND delivered_at IS NULL
          AND COALESCE(last_delivery_reminder_at, decided_at) <= now() - make_interval(days => $1)
          FOR UPDATE SKIP LOCKED
     )
     UPDATE "Adoption" a SET last_delivery_reminder_at = now()
       FROM due, "Pet" p, "Shelter" s, "Adopter" ad
      WHERE a.id = due.id AND p.id = a.pet_id AND s.user_id = p.shelter_id AND ad.user_id = a.adopter_id
     RETURNING ${REMINDED_ADOPTION}`,
    [intervalDays],
  );
  return rows.sort((x, y) => x.id - y.id);
}

/** RN-128, CU-48: marks as alerted (once) the APPROVED adoptions approved at least `deadlineDays` ago. */
export async function markOverdueAdoptions(db: Db, deadlineDays: number): Promise<RemindedAdoption[]> {
  const { rows } = await db.query<RemindedAdoption>(
    `WITH due AS (
       SELECT id FROM "Adoption"
        WHERE status = 'APPROVED' AND delivered_at IS NULL AND admin_alerted_at IS NULL
          AND decided_at <= now() - make_interval(days => $1)
          FOR UPDATE SKIP LOCKED
     )
     UPDATE "Adoption" a SET admin_alerted_at = now()
       FROM due, "Pet" p, "Shelter" s, "Adopter" ad
      WHERE a.id = due.id AND p.id = a.pet_id AND s.user_id = p.shelter_id AND ad.user_id = a.adopter_id
     RETURNING ${REMINDED_ADOPTION}`,
    [deadlineDays],
  );
  return rows.sort((x, y) => x.id - y.id);
}
