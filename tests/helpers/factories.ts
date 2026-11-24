/**
 * Data factories for the integration tests. Each one inserts the minimum valid rows
 * and accepts overrides. They write straight to the database (no business rules), so
 * a test can build any starting state.
 */
import { getPool } from "../../src/server/db/pool.js";

let sequence = 0;
const next = (): number => ++sequence;

/** Placeholder hash: the factories do not need a real password until login exists. */
const DUMMY_PASSWORD_HASH = "not-a-real-hash";
/** INE code of Gipuzkoa. */
const DEFAULT_PROVINCE_ID = 20;

export interface CreatedUser {
  id: number;
  email: string;
}

export interface UserOptions {
  email?: string;
  passwordHash?: string;
  verified?: boolean;
}

async function insertUser(role: "ADOPTER" | "SHELTER" | "ADMIN", options: UserOptions): Promise<CreatedUser> {
  const email = options.email ?? `${role.toLowerCase()}${String(next())}@example.test`;
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO "App_user" (email, password_hash, role, email_verified_at, terms_accepted_at)
     VALUES ($1, $2, $3, CASE WHEN $4::boolean THEN now() END, now())
     RETURNING id`,
    [email, options.passwordHash ?? DUMMY_PASSWORD_HASH, role, options.verified ?? true],
  );
  const row = rows[0];
  if (!row) throw new Error("insertUser: no row returned");
  return { id: row.id, email };
}

export interface AdopterOptions extends UserOptions {
  firstName?: string;
  lastName?: string;
  birthDate?: string;
  provinceId?: number;
}

export async function createAdopter(options: AdopterOptions = {}): Promise<CreatedUser> {
  const user = await insertUser("ADOPTER", options);
  await getPool().query(
    `INSERT INTO "Adopter" (user_id, first_name, last_name, phone, birth_date, province_id, locality)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      user.id,
      options.firstName ?? "Adoptante",
      options.lastName ?? "De Prueba",
      "600000000",
      options.birthDate ?? "1990-01-01",
      options.provinceId ?? DEFAULT_PROVINCE_ID,
      "Donostia",
    ],
  );
  return user;
}

export interface ShelterOptions extends UserOptions {
  name?: string;
  validationStatus?: "PENDING" | "VALIDATED" | "REJECTED";
  provinceId?: number;
}

export async function createShelter(options: ShelterOptions = {}): Promise<CreatedUser> {
  const user = await insertUser("SHELTER", options);
  const status = options.validationStatus ?? "VALIDATED";
  const n = next();
  await getPool().query(
    `INSERT INTO "Shelter" (user_id, name, cif, address, province_id, locality, phone,
                            validation_status, validation_reason, validated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $8 = 'VALIDATED' THEN now() END)`,
    [
      user.id,
      options.name ?? `Protectora ${String(n)}`,
      `G${String(n).padStart(8, "0")}`,
      "Calle Falsa 1",
      options.provinceId ?? DEFAULT_PROVINCE_ID,
      "Donostia",
      "943000000",
      status,
      status === "REJECTED" ? "Datos incorrectos" : null,
    ],
  );
  return user;
}

export async function createAdmin(options: UserOptions = {}): Promise<CreatedUser> {
  return insertUser("ADMIN", options);
}

export interface PetOptions {
  shelterId: number;
  name?: string;
  breedId?: number;
  birthDate?: string;
  sex?: "MALE" | "FEMALE";
  size?: "SMALL" | "MEDIUM" | "LARGE";
  activityLevel?: "LOW" | "MEDIUM" | "HIGH";
}

export interface CreatedPet {
  id: number;
}

export async function createPet(options: PetOptions): Promise<CreatedPet> {
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO "Pet" (shelter_id, breed_id, name, description, birth_date, sex, size, activity_level,
                        vaccinated, dewormed, sterilized, microchipped)
     VALUES ($1, COALESCE($2::int, (SELECT min(id) FROM "Breed")), $3, $4, $5, $6, $7, $8, true, true, true, true)
     RETURNING id`,
    [
      options.shelterId,
      options.breedId ?? null,
      options.name ?? `Mascota ${String(next())}`,
      "Una mascota de prueba.",
      options.birthDate ?? "2022-01-01",
      options.sex ?? "FEMALE",
      options.size ?? "MEDIUM",
      options.activityLevel ?? "MEDIUM",
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("createPet: no row returned");
  return { id: row.id };
}

export interface VisitSlotOptions {
  shelterId: number;
  /** Defaults to 7 days from now. */
  startsAt?: Date;
  /** Defaults to one hour. */
  durationMinutes?: number;
  capacity?: number;
}

export async function createVisitSlot(options: VisitSlotOptions): Promise<{ id: number }> {
  const startsAt = options.startsAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + (options.durationMinutes ?? 60) * 60 * 1000);
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO "Visit_slot" (shelter_id, starts_at, ends_at, capacity) VALUES ($1, $2, $3, $4) RETURNING id`,
    [options.shelterId, startsAt, endsAt, options.capacity ?? 1],
  );
  const row = rows[0];
  if (!row) throw new Error("createVisitSlot: no row returned");
  return { id: row.id };
}

export interface VisitOptions {
  adopterId: number;
  shelterId: number;
  petId: number;
  slotId: number;
  status?: "PENDING" | "CONFIRMED";
}

export async function createVisit(options: VisitOptions): Promise<{ id: number }> {
  const status = options.status ?? "PENDING";
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO "Visit" (adopter_id, shelter_id, pet_id, slot_id, status, responded_at)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 = 'CONFIRMED' THEN now() END)
     RETURNING id`,
    [options.adopterId, options.shelterId, options.petId, options.slotId, status],
  );
  const row = rows[0];
  if (!row) throw new Error("createVisit: no row returned");
  return { id: row.id };
}
