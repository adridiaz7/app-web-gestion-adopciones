import type { Db } from "../db/transaction.js";
import type { Household } from "./adopters.js";
import type { VisitStatus } from "./visits.js";

/** CU-22, RN-27: what a shelter sees of an adopter who has sent it a request. */
export interface AdopterForShelter {
  id: number;
  name: string;
  provinceName: string;
  household: Household;
}

/** RN-29: only if the adopter has sent this shelter some request (every adoption needs a visit). */
export async function selectAdopterForShelter(db: Db, shelterId: number, adopterId: number): Promise<AdopterForShelter | null> {
  const { rows } = await db.query<AdopterForShelter>(
    `SELECT a.user_id AS id, a.first_name || ' ' || a.last_name AS name, pv.name AS "provinceName",
            json_build_object('housingType', a.housing_type, 'hasOutdoorSpace', a.has_outdoor_space,
                              'housingTenure', a.housing_tenure, 'householdMembers', a.household_members,
                              'hasChildren', a.has_children, 'hasOtherPets', a.has_other_pets,
                              'otherPetsDescription', a.other_pets_description, 'hasPetExperience', a.has_pet_experience,
                              'hoursAlonePerDay', a.hours_alone_per_day) AS household
       FROM "Adopter" a
       JOIN "Province" pv ON pv.id = a.province_id
      WHERE a.user_id = $2
        AND EXISTS (SELECT 1 FROM "Visit" v WHERE v.adopter_id = a.user_id AND v.shelter_id = $1)`,
    [shelterId, adopterId],
  );
  return rows[0] ?? null;
}

/** A visit of the adopter's history with one shelter. */
export interface AdopterHistoryVisit {
  id: number;
  petName: string;
  status: VisitStatus;
  startsAt: Date;
  endsAt: Date;
}

/** RN-29: the adopter's visits with this shelter only, most recent first. */
export async function selectAdopterHistory(db: Db, shelterId: number, adopterId: number): Promise<AdopterHistoryVisit[]> {
  const { rows } = await db.query<AdopterHistoryVisit>(
    `SELECT v.id, p.name AS "petName", v.status, vs.starts_at AS "startsAt", vs.ends_at AS "endsAt"
       FROM "Visit" v
       JOIN "Pet"        p  ON p.id = v.pet_id
       JOIN "Visit_slot" vs ON vs.id = v.slot_id
      WHERE v.shelter_id = $1 AND v.adopter_id = $2
      ORDER BY vs.starts_at DESC, v.id DESC`,
    [shelterId, adopterId],
  );
  return rows;
}
