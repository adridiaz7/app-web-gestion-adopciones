import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import { BadRequestError } from "../errors.js";
import { countSpecies } from "../models/pets.js";
import { countBreeds, deleteDiscards, lockAdopter, savePreferences, selectPreferences, type Preferences } from "../models/preferences.js";
import { audit } from "./audit.js";

export type { Preferences };

/** CU-08: the adopter's preferences, or null if they never filled in the questionnaire (RN-30, RN-190). */
export async function getPreferences(adopterId: number): Promise<Preferences | null> {
  return selectPreferences(getPool(), adopterId);
}

/**
 * CU-08, RN-31: saves the questionnaire (all answers optional, RN-34). RN-38: the adopter's
 * discards are deleted so those pets can show up again; favourites stay. RN-208: the change
 * is recorded with the old and new answers.
 */
export async function updatePreferences(adopterId: number, prefs: Preferences): Promise<Preferences> {
  if (prefs.minAgeMonths !== null && prefs.maxAgeMonths !== null && prefs.minAgeMonths > prefs.maxAgeMonths) {
    throw new BadRequestError("La edad mínima no puede ser mayor que la máxima.");
  }

  return withTransaction(async (client) => {
    const species = [...new Set([...prefs.speciesIds, ...prefs.mustGetAlongWithSpeciesIds])];
    if ((await countSpecies(client, species)) !== species.length) throw new BadRequestError("Alguna de las especies no existe.");
    if ((await countBreeds(client, prefs.breedIds)) !== prefs.breedIds.length) throw new BadRequestError("Alguna de las razas no existe.");

    await lockAdopter(client, adopterId);
    const before = await selectPreferences(client, adopterId);
    await savePreferences(client, adopterId, prefs);
    await deleteDiscards(client, adopterId);
    const after = await selectPreferences(client, adopterId);
    if (!after) throw new Error("updatePreferences: preferences not saved");

    await audit(client, {
      actorUserId: adopterId,
      action: "PREFERENCES_UPDATED",
      entityType: "Adopter_preferences",
      entityId: adopterId,
      details: { before, after },
    });
    return after;
  });
}
