import type { Db } from "../db/transaction.js";
import { visiblePetCondition } from "./gallery.js";

/** RN-24: validated, not suspended and not deleted (aliases s = "Shelter", su = its "App_user"). */
const LISTED_SHELTER = `s.validation_status = 'VALIDATED'
      AND su.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM "Suspension" sp WHERE sp.user_id = s.user_id AND sp.ended_at IS NULL)`;

export interface ShelterSearchFilters {
  /** Part of the name, any case. */
  name?: string | undefined;
  provinceId?: number | undefined;
}

/** A shelter card in the search (CU-13). */
export interface ShelterCard {
  id: number;
  name: string;
  description: string | null;
  logoUrl: string | null;
  locality: string;
  provinceName: string;
  /** Pets this adopter can see (0 when the shelter blocked them, RN-77). */
  availablePets: number;
}

/** A shelter's public profile (CU-13). */
export interface ShelterProfile {
  id: number;
  name: string;
  description: string | null;
  logoUrl: string | null;
  address: string;
  locality: string;
  provinceName: string;
  phone: string;
  contactEmail: string | null;
  website: string | null;
  openingHours: string | null;
}

/** CU-13, RN-69: the listed shelters that match the filters, by name. */
export async function selectShelters(db: Db, adopterId: number | null, filters: ShelterSearchFilters): Promise<ShelterCard[]> {
  const { rows } = await db.query<ShelterCard>(
    `SELECT s.user_id AS id, s.name, s.description, s.logo_path AS "logoUrl", s.locality, pv.name AS "provinceName",
            (SELECT count(*)::int FROM "Pet" p WHERE p.shelter_id = s.user_id AND ${visiblePetCondition("$1")}) AS "availablePets"
       FROM "Shelter" s
       JOIN "App_user" su ON su.id = s.user_id
       JOIN "Province" pv ON pv.id = s.province_id
      WHERE ${LISTED_SHELTER}
        AND ($2::text IS NULL OR strpos(lower(s.name), lower($2)) > 0)
        AND ($3::smallint IS NULL OR s.province_id = $3)
      ORDER BY s.name, s.user_id`,
    [adopterId, filters.name ?? null, filters.provinceId ?? null],
  );
  return rows;
}

/** CU-13: a listed shelter's public profile, or null (RN-24). */
export async function selectShelterProfile(db: Db, shelterId: number): Promise<ShelterProfile | null> {
  const { rows } = await db.query<ShelterProfile>(
    `SELECT s.user_id AS id, s.name, s.description, s.logo_path AS "logoUrl", s.address, s.locality,
            pv.name AS "provinceName", s.phone, s.contact_email AS "contactEmail", s.website,
            s.opening_hours AS "openingHours"
       FROM "Shelter" s
       JOIN "App_user" su ON su.id = s.user_id
       JOIN "Province" pv ON pv.id = s.province_id
      WHERE s.user_id = $1 AND ${LISTED_SHELTER}`,
    [shelterId],
  );
  return rows[0] ?? null;
}

/** RN-149: the active block of this shelter on this adopter, if any (end date null = permanent). */
export async function selectActiveBlock(db: Db, shelterId: number, adopterId: number): Promise<{ endsAt: Date | null } | null> {
  const { rows } = await db.query<{ endsAt: Date | null }>(
    `SELECT ends_at AS "endsAt" FROM "Block" WHERE shelter_id = $1 AND adopter_id = $2 AND lifted_at IS NULL`,
    [shelterId, adopterId],
  );
  return rows[0] ?? null;
}
