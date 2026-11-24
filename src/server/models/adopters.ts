import type { Db } from "../db/transaction.js";

export interface AdopterInsert {
  userId: number;
  firstName: string;
  lastName: string;
  phone: string;
  birthDate: string;
  provinceId: number;
  locality: string;
}

/** Household data (RN-27) is optional at sign-up, so it is left empty here. */
export async function insertAdopter(db: Db, adopter: AdopterInsert): Promise<void> {
  await db.query(
    `INSERT INTO "Adopter" (user_id, first_name, last_name, phone, birth_date, province_id, locality)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      adopter.userId,
      adopter.firstName,
      adopter.lastName,
      adopter.phone,
      adopter.birthDate,
      adopter.provinceId,
      adopter.locality,
    ],
  );
}
