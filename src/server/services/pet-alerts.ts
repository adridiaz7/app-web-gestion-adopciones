import type { Db } from "../db/transaction.js";
import {
  selectAlertPet,
  selectAvailablePetIds,
  selectCompatibleAdopters,
  selectFavoriteAdopters,
  selectPetAdoptionAdopters,
} from "../models/pet-alerts.js";
import { createNotification } from "./notifications.js";

export type FavoriteStatus = "AVAILABLE" | "RESERVED" | "ADOPTED" | "UNLISTED";

/**
 * RN-200, CU-55: tells the adopters who have the pet in their favourites that it changed to
 * `status`. Those with an adoption of this pet are left out: they already get the alerts of
 * their own adoption. Call it in the transaction of the change (RN-171).
 */
export async function alertFavorites(db: Db, petId: number, status: FavoriteStatus, alreadyTold: number[] = []): Promise<void> {
  const pet = await selectAlertPet(db, petId);
  if (!pet) return;
  const excluded = [...alreadyTold, ...(await selectPetAdoptionAdopters(db, petId))];
  for (const userId of await selectFavoriteAdopters(db, petId, excluded)) {
    await createNotification(db, { userId, type: "FAVORITE_STATUS_CHANGED", params: { petName: pet.name, status }, link: { petId } });
  }
}

/**
 * RN-199, CU-54: tells the compatible adopters with a questionnaire that the pet is available
 * and visible for them (not those who have it in favourites, nor those with an adoption of it).
 */
export async function alertCompatibleAdopters(db: Db, petId: number, alreadyTold: number[] = []): Promise<void> {
  const pet = await selectAlertPet(db, petId);
  if (!pet) return;
  const excluded = [...alreadyTold, ...(await selectPetAdoptionAdopters(db, petId))];
  for (const userId of await selectCompatibleAdopters(db, petId, excluded)) {
    await createNotification(db, { userId, type: "NEW_COMPATIBLE_PET", params: { petName: pet.name, shelterName: pet.shelterName }, link: { petId } });
  }
}

/** RN-199, RN-200: the pet is AVAILABLE again (or for the first time). `alreadyTold` already got another alert about it. */
export async function alertPetAvailable(db: Db, petId: number, alreadyTold: number[] = []): Promise<void> {
  await alertFavorites(db, petId, "AVAILABLE", alreadyTold);
  await alertCompatibleAdopters(db, petId, alreadyTold);
}

/** RN-199, RN-23: a shelter has just become visible, so its available pets are new for the adopters. */
export async function alertShelterPets(db: Db, shelterId: number): Promise<void> {
  for (const petId of await selectAvailablePetIds(db, shelterId)) await alertCompatibleAdopters(db, petId);
}
