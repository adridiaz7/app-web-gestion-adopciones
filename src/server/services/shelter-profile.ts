import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { withTransaction, type Db } from "../db/transaction.js";
import { BadRequestError, NotFoundError } from "../errors.js";
import { provinceExists } from "../models/provinces.js";
import {
  selectShelterOwnProfile,
  updateShelterLogo,
  updateShelterPublicData,
  type ShelterOwnProfile,
  type ShelterPublicData,
} from "../models/shelters.js";
import { audit } from "./audit.js";
import { fieldChanges, hasChanges, type FieldChanges } from "./field-changes.js";
import { imageExtension } from "./pet-photos.js";

export type ShelterProfile = ShelterOwnProfile;
export type { ShelterPublicData };

const NOT_FOUND = "La protectora no existe.";
const NOT_AN_IMAGE = "El logo tiene que ser una imagen JPEG, PNG o WebP.";
const UPLOADS_URL = "/uploads/";

const PUBLIC_FIELDS = [
  "description",
  "address",
  "provinceId",
  "locality",
  "phone",
  "contactEmail",
  "website",
  "openingHours",
] as const satisfies readonly (keyof ShelterPublicData)[];

const fileOf = (url: string): string => join(getConfig().uploadsDir, url.slice(UPLOADS_URL.length));

async function lockProfile(db: Db, shelterId: number): Promise<ShelterProfile> {
  const profile = await selectShelterOwnProfile(db, shelterId, true);
  if (!profile) throw new NotFoundError(NOT_FOUND);
  return profile;
}

/** RN-208: an edit of the shelter's profile, with its old and new values. */
async function auditProfile(db: Db, shelterId: number, diff: FieldChanges): Promise<void> {
  if (!hasChanges(diff)) return;
  await audit(db, { actorUserId: shelterId, action: "PROFILE_UPDATED", entityType: "Shelter", entityId: shelterId, details: diff });
}

async function reload(db: Db, shelterId: number): Promise<ShelterProfile> {
  const profile = await selectShelterOwnProfile(db, shelterId);
  if (!profile) throw new NotFoundError(NOT_FOUND);
  return profile;
}

/** CU-06: the shelter's own profile. */
export async function getShelterOwnProfile(shelterId: number): Promise<ShelterProfile> {
  return reload(getPool(), shelterId);
}

/**
 * CU-06: edits the public data of the shelter (the name and the CIF are not edited here).
 * RN-208: audited with the old and new values of the fields that change, in the same transaction (RN-171).
 */
export async function editShelterProfile(shelterId: number, input: ShelterPublicData): Promise<ShelterProfile> {
  return withTransaction(async (client) => {
    if (!(await provinceExists(client, input.provinceId))) throw new BadRequestError("La provincia no existe.");
    const before = await lockProfile(client, shelterId);
    await updateShelterPublicData(client, shelterId, input);
    await auditProfile(client, shelterId, fieldChanges<ShelterPublicData>(before, input, PUBLIC_FIELDS));
    return reload(client, shelterId);
  });
}

/**
 * CU-06: sets the shelter's logo (null removes it). RN-52: the file is saved under a random
 * name and only its path goes to the database. The old file is deleted after the commit.
 */
export async function setShelterLogo(shelterId: number, file: Buffer | null): Promise<ShelterProfile> {
  let url: string | null = null;
  if (file) {
    const extension = imageExtension(file);
    if (!extension) throw new BadRequestError(NOT_AN_IMAGE);
    const { uploadsDir } = getConfig();
    const name = `${randomUUID()}.${extension}`;
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(join(uploadsDir, name), file);
    url = `${UPLOADS_URL}${name}`;
  }

  try {
    const { profile, oldUrl } = await withTransaction(async (client) => {
      const before = await lockProfile(client, shelterId);
      await updateShelterLogo(client, shelterId, url);
      await auditProfile(client, shelterId, fieldChanges({ logoUrl: before.logoUrl }, { logoUrl: url }, ["logoUrl"]));
      return { profile: await reload(client, shelterId), oldUrl: before.logoUrl };
    });
    if (oldUrl && oldUrl !== url) await rm(fileOf(oldUrl), { force: true });
    return profile;
  } catch (error) {
    if (url) await rm(fileOf(url), { force: true });
    throw error;
  }
}
