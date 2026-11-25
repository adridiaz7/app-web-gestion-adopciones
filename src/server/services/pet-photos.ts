import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { withTransaction, type Db } from "../db/transaction.js";
import { BadRequestError, ConflictError, NotFoundError } from "../errors.js";
import {
  deletePetPhoto,
  insertPetPhoto,
  selectPetPhotos,
  setPhotoPositions,
  type PetPhoto,
} from "../models/pet-photos.js";
import { selectShelterPet } from "../models/pets.js";
import { audit } from "./audit.js";

export type { PetPhoto };

const PET_NOT_FOUND = "La mascota no existe.";
const PHOTO_NOT_FOUND = "La foto no existe.";
const NOT_AN_IMAGE = "La foto tiene que ser una imagen JPEG, PNG o WebP.";
const BAD_ORDER = "El nuevo orden tiene que incluir todas las fotos de la mascota, una vez cada una.";
const UPLOADS_URL = "/uploads/";

/** The image format, judged by the file's contents (its signature), not by its name. */
export function imageExtension(file: Buffer): "jpg" | "png" | "webp" | null {
  if (file.length >= 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff) return "jpg";
  if (file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (file.subarray(0, 4).toString("latin1") === "RIFF" && file.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

const fileOf = (url: string): string => join(getConfig().uploadsDir, url.slice(UPLOADS_URL.length));

/** Deletes a photo's file. A file already gone is not an error: the row is what counts. */
async function removeFile(url: string): Promise<void> {
  await rm(fileOf(url), { force: true });
}

/** Locks the shelter's pet, or 404 when it does not exist or belongs to another shelter. */
async function lockOwnPet(db: Db, shelterId: number, petId: number): Promise<void> {
  if (!(await selectShelterPet(db, shelterId, petId, true))) throw new NotFoundError(PET_NOT_FOUND);
}

/** RN-208: editing the photos is an edit of the pet's profile, recorded with the old and new lists. */
async function auditPhotos(db: Db, shelterId: number, petId: number, before: PetPhoto[]): Promise<PetPhoto[]> {
  const after = await selectPetPhotos(db, petId);
  await audit(db, {
    actorUserId: shelterId,
    action: "PET_PHOTOS_UPDATED",
    entityType: "Pet",
    entityId: petId,
    details: { before: { photos: before.map((p) => p.url) }, after: { photos: after.map((p) => p.url) } },
  });
  return after;
}

/** CU-16: the photos of one of the shelter's pets, in order. */
export async function listPetPhotos(shelterId: number, petId: number): Promise<PetPhoto[]> {
  const pool = getPool();
  if (!(await selectShelterPet(pool, shelterId, petId))) throw new NotFoundError(PET_NOT_FOUND);
  return selectPetPhotos(pool, petId);
}

/**
 * CU-15, CU-16: adds a photo after the existing ones (RN-51), up to the configured maximum
 * (RN-50). Only JPEG, PNG and WebP, checked by content. RN-52: the file is saved under a
 * random name and the database keeps only its path.
 */
export async function addPetPhoto(shelterId: number, petId: number, file: Buffer): Promise<PetPhoto[]> {
  const extension = imageExtension(file);
  if (!extension) throw new BadRequestError(NOT_AN_IMAGE);

  const { uploadsDir, rules } = getConfig();
  const name = `${randomUUID()}.${extension}`;
  const url = `${UPLOADS_URL}${name}`;
  let written = false;

  try {
    return await withTransaction(async (client) => {
      await lockOwnPet(client, shelterId, petId);
      const before = await selectPetPhotos(client, petId);
      if (before.length >= rules.maxPhotosPerPet) {
        throw new ConflictError(`Una mascota puede tener como máximo ${String(rules.maxPhotosPerPet)} fotos.`);
      }

      await mkdir(uploadsDir, { recursive: true });
      await writeFile(join(uploadsDir, name), file);
      written = true;
      await insertPetPhoto(client, petId, url, before.length + 1);
      return auditPhotos(client, shelterId, petId, before);
    });
  } catch (error) {
    if (written) await removeFile(url);
    throw error;
  }
}

/** CU-16: deletes a photo and closes the gap in the order (RN-51). The file goes after the commit. */
export async function removePetPhoto(shelterId: number, petId: number, photoId: number): Promise<PetPhoto[]> {
  const { photos, url } = await withTransaction(async (client) => {
    await lockOwnPet(client, shelterId, petId);
    const before = await selectPetPhotos(client, petId);
    const deleted = await deletePetPhoto(client, petId, photoId);
    if (!deleted) throw new NotFoundError(PHOTO_NOT_FOUND);
    await setPhotoPositions(
      client,
      petId,
      before.filter((p) => p.id !== photoId).map((p) => p.id),
    );
    return { photos: await auditPhotos(client, shelterId, petId, before), url: deleted };
  });
  await removeFile(url);
  return photos;
}

/** CU-16, RN-51: puts the photos in the given order; the first one becomes the main photo. */
export async function reorderPetPhotos(shelterId: number, petId: number, photoIds: number[]): Promise<PetPhoto[]> {
  return withTransaction(async (client) => {
    await lockOwnPet(client, shelterId, petId);
    const before = await selectPetPhotos(client, petId);
    const current = new Set(before.map((p) => p.id));
    const sameSet = photoIds.length === current.size && new Set(photoIds).size === photoIds.length && photoIds.every((id) => current.has(id));
    if (!sameSet) throw new BadRequestError(BAD_ORDER);

    await setPhotoPositions(client, petId, photoIds);
    return auditPhotos(client, shelterId, petId, before);
  });
}
