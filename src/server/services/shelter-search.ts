import { getPool } from "../db/pool.js";
import { NotFoundError } from "../errors.js";
import { selectGalleryPets, type GalleryPet } from "../models/gallery.js";
import {
  selectActiveBlock,
  selectShelterProfile,
  selectShelters,
  type ShelterCard,
  type ShelterProfile,
  type ShelterSearchFilters,
} from "../models/shelter-search.js";
import { adopterOf, type Viewer } from "./gallery.js";

export type { ShelterCard, ShelterProfile, ShelterSearchFilters };

export interface ShelterPage {
  shelter: ShelterProfile;
  /** RN-149: the active block on this adopter (endsAt null = permanent), or null. */
  block: { endsAt: Date | null } | null;
  /** Its available pets; none while the shelter blocks the adopter (RN-77). */
  pets: GalleryPet[];
}

/** CU-13, RN-69: search for shelters; only validated and not suspended ones (RN-24). */
export async function searchShelters(viewer: Viewer, filters: ShelterSearchFilters): Promise<ShelterCard[]> {
  return selectShelters(getPool(), adopterOf(viewer), filters);
}

/**
 * CU-13: a shelter's profile and its pets. RN-149: when it blocks the adopter, the profile
 * shows the restricted-access notice and no pets.
 */
export async function getShelterPage(viewer: Viewer, shelterId: number): Promise<ShelterPage> {
  const pool = getPool();
  const shelter = await selectShelterProfile(pool, shelterId);
  if (!shelter) throw new NotFoundError("Esta protectora no está disponible.");

  const adopterId = adopterOf(viewer);
  const block = adopterId === null ? null : await selectActiveBlock(pool, shelterId, adopterId);
  const pets = block ? [] : await selectGalleryPets(pool, adopterId, { shelterId });
  return { shelter, block, pets };
}
