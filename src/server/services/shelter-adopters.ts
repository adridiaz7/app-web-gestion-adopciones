import { getPool } from "../db/pool.js";
import { NotFoundError } from "../errors.js";
import { selectAdopterForShelter, selectAdopterHistory, type AdopterForShelter, type AdopterHistoryVisit } from "../models/shelter-adopters.js";

export interface AdopterProfileForShelter extends AdopterForShelter {
  /** RN-102: visits with this shelter the adopter did not come to. */
  noShows: number;
  visits: AdopterHistoryVisit[];
}

/**
 * CU-22: the profile of an adopter from the shelter's inbox: name, province, household data
 * (RN-27) and the history of visits and no-shows with this shelter. RN-29: only of adopters
 * who have sent it some request, and never their history with other shelters.
 */
export async function getAdopterProfileForShelter(shelterId: number, adopterId: number): Promise<AdopterProfileForShelter> {
  const pool = getPool();
  const adopter = await selectAdopterForShelter(pool, shelterId, adopterId);
  if (!adopter) throw new NotFoundError("El adoptante no existe.");
  const visits = await selectAdopterHistory(pool, shelterId, adopterId);
  return { ...adopter, noShows: visits.filter((visit) => visit.status === "NO_SHOW").length, visits };
}
