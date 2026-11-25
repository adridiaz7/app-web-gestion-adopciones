import type { Db } from "../db/transaction.js";

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
