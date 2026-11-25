import { getConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors.js";
import { selectVisiblePet } from "../models/gallery.js";
import { selectActiveBlock } from "../models/shelter-search.js";
import { countOccupied, lockShelterSlot } from "../models/visit-slots.js";
import {
  ensureConversation,
  hasNoShow,
  insertVisit,
  lockPetForRequest,
  petHasActiveVisit,
  selectAvailableSlots,
  selectQuotaVisitEnds,
  selectRequestedVisit,
  type AvailableSlot,
  type RequestedVisit,
} from "../models/visits.js";
import { audit } from "./audit.js";

export type { AvailableSlot, RequestedVisit };

const PET_NOT_AVAILABLE = "Esta mascota no está disponible.";
const HOUR = 60 * 60 * 1000;
const madridDay = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long", year: "numeric" });

/** RN-194: the slots the adopter can choose for a pet visible to them (same visibility as its profile). */
export async function listAvailableSlots(adopterId: number, petId: number): Promise<AvailableSlot[]> {
  const pool = getPool();
  const pet = await selectVisiblePet(pool, adopterId, petId);
  if (!pet) throw new NotFoundError(PET_NOT_AVAILABLE);
  return selectAvailableSlots(pool, pet.shelter.id, petId, getConfig().rules.visitMinNoticeHours);
}

/**
 * CU-23: requests a visit to a pet in one of its shelter's slots. It stays PENDING until the
 * shelter answers. The first request to a shelter opens the conversation (RN-134). One
 * transaction (RN-171), audited (RN-208).
 */
export async function requestVisit(adopterId: number, petId: number, slotId: number): Promise<RequestedVisit> {
  const rules = getConfig().rules;
  return withTransaction(async (client) => {
    const pet = await lockPetForRequest(client, petId);
    if (!pet?.shelterVisible) throw new NotFoundError(PET_NOT_AVAILABLE);

    // RN-88: same neutral text as the notice on the shelter's profile (RN-149).
    const block = await selectActiveBlock(client, pet.shelterId, adopterId);
    if (block) {
      const until = block.endsAt ? ` hasta el ${madridDay.format(block.endsAt)}` : "";
      throw new ForbiddenError(`La protectora ${pet.shelterName} ha restringido tu acceso a sus mascotas${until}.`);
    }
    // RN-86
    if (pet.status !== "AVAILABLE") throw new ConflictError(PET_NOT_AVAILABLE);
    // RN-89, RN-102
    if (await hasNoShow(client, adopterId, pet.shelterId)) {
      throw new ForbiddenError("No puedes solicitar más visitas en esta protectora porque no acudiste a una visita confirmada.");
    }

    // RN-83: the slot is one of the pet's shelter. Locked, so two requests cannot take the last place.
    const slot = await lockShelterSlot(client, pet.shelterId, slotId);
    if (!slot) throw new NotFoundError("El turno no existe.");
    // RN-87
    if (slot.startsAt.getTime() < Date.now() + rules.visitMinNoticeHours * HOUR) {
      throw new ConflictError(`La visita se tiene que solicitar con al menos ${String(rules.visitMinNoticeHours)} horas de antelación.`);
    }
    // RN-82
    if ((await countOccupied(client, slotId)) >= slot.capacity) throw new ConflictError("Este turno ya no tiene plazas libres.");
    // RN-81
    if (await petHasActiveVisit(client, petId, slotId)) throw new ConflictError("Esta mascota ya tiene una visita en este turno. Elige otro.");

    // RN-90, RN-91, RN-92; RN-93: tell when the next place frees up.
    const counted = await selectQuotaVisitEnds(client, adopterId, pet.shelterId, rules.visitQuotaWindowMonths);
    if (counted.length >= rules.visitQuotaPerShelter) {
      const freedBy = counted[counted.length - rules.visitQuotaPerShelter];
      const from = freedBy ? ` Podrás solicitar otra a partir del ${madridDay.format(freedBy)}.` : "";
      throw new ConflictError(
        `Ya tienes ${String(rules.visitQuotaPerShelter)} visitas confirmadas o realizadas en esta protectora en los últimos ${String(rules.visitQuotaWindowMonths)} meses.${from}`,
      );
    }

    const visitId = await insertVisit(client, adopterId, pet.shelterId, petId, slotId);
    await ensureConversation(client, adopterId, pet.shelterId);
    await audit(client, {
      actorUserId: adopterId,
      action: "VISIT_REQUESTED",
      entityType: "Visit",
      entityId: visitId,
      details: { after: { status: "PENDING" } },
    });

    const visit = await selectRequestedVisit(client, visitId);
    if (!visit) throw new Error("visit not found after creating it");
    return visit;
  });
}
