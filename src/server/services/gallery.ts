import { getPool } from "../db/pool.js";
import { NotFoundError } from "../errors.js";
import { selectGalleryPets, selectVisiblePet, type GalleryFilters, type GalleryPet, type PetProfile } from "../models/gallery.js";
import type { Role } from "../models/users.js";

export type { GalleryFilters, GalleryPet, PetProfile };

/** Who is looking at the gallery: nobody (a visitor, RN-187) or a user with a role. */
export interface Viewer {
  id: number;
  role: Role;
}

/** RN-77: blocks only hide pets from the blocked adopter. */
export const adopterOf = (viewer: Viewer | undefined): number | null => (viewer?.role === "ADOPTER" ? viewer.id : null);

/**
 * CU-09: the gallery. Only visible pets (RN-58, RN-23); for an adopter, without the pets of
 * shelters that blocked them (RN-77). It ignores the adopter's preferences (RN-189).
 */
export async function listGalleryPets(viewer: Viewer | undefined, filters: GalleryFilters): Promise<GalleryPet[]> {
  return selectGalleryPets(getPool(), adopterOf(viewer), filters);
}

/**
 * CU-11: a pet's profile, with the same visibility as the gallery (RN-58, RN-23, RN-77).
 * One message for every case, so a blocked adopter does not learn about the block.
 */
export async function getPetProfile(viewer: Viewer, petId: number): Promise<PetProfile> {
  const pet = await selectVisiblePet(getPool(), adopterOf(viewer), petId);
  if (!pet) throw new NotFoundError("Esta mascota no está disponible.");
  return pet;
}
