import { getPool } from "../db/pool.js";
import { selectGalleryPets, type GalleryFilters, type GalleryPet } from "../models/gallery.js";
import type { Role } from "../models/users.js";

export type { GalleryFilters, GalleryPet };

/** Who is looking at the gallery: nobody (a visitor, RN-187) or a user with a role. */
export interface Viewer {
  id: number;
  role: Role;
}

/**
 * CU-09: the gallery. Only visible pets (RN-58, RN-23); for an adopter, without the pets of
 * shelters that blocked them (RN-77). It ignores the adopter's preferences (RN-189).
 */
export async function listGalleryPets(viewer: Viewer | undefined, filters: GalleryFilters): Promise<GalleryPet[]> {
  const adopterId = viewer?.role === "ADOPTER" ? viewer.id : null;
  return selectGalleryPets(getPool(), adopterId, filters);
}
