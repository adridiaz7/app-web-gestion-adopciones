import { getConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { withTransaction, type Db } from "../db/transaction.js";
import { ConflictError, NotFoundError } from "../errors.js";
import { cancelApprovedAdoptions, releaseReservedPet, selectNotSelectedAdopters, voidPendingAdoptions } from "../models/adoptions.js";
import {
  hasBlockedBefore,
  insertBlockIfNoneActive,
  liftBlock,
  liftExpiredTemporaryBlocks,
  selectActiveBlockOfPair,
  selectShelterName,
  type Block,
  type BlockReason,
} from "../models/blocks.js";
import { selectAdopterForShelter } from "../models/shelter-adopters.js";
import { voidOpenVisits } from "../models/visits.js";
import { audit } from "./audit.js";
import { createNotification } from "./notifications.js";

export type { Block, BlockReason };

const ALREADY_BLOCKED = "Este adoptante ya está bloqueado.";
const NOT_BLOCKED = "Este adoptante no está bloqueado.";

/** RN-146, RN-29: the shelter only deals with adopters who have sent it some request. */
async function ensureKnownAdopter(db: Db, shelterId: number, adopterId: number): Promise<void> {
  if (!(await selectAdopterForShelter(db, shelterId, adopterId))) throw new NotFoundError("El adoptante no existe.");
}

/** CU-35: the active block of the adopter by this shelter, or null. */
export async function getActiveBlock(shelterId: number, adopterId: number): Promise<Block | null> {
  const pool = getPool();
  await ensureKnownAdopter(pool, shelterId, adopterId);
  return selectActiveBlockOfPair(pool, shelterId, adopterId);
}

/**
 * RN-148: the effects of a block, all at once. The adopter's open visits and pending
 * adoptions at the shelter are voided (ADOPTER_BLOCKED), and an approved adoption is
 * cancelled by the shelter, so its pet is available again and the not-selected adopters are
 * told (RN-130). Every change is notified (RN-110) with a neutral text and audited.
 */
async function applyBlockEffects(db: Db, shelterId: number, shelterName: string, adopterId: number): Promise<void> {
  for (const visit of await voidOpenVisits(db, adopterId, shelterId, "ADOPTER_BLOCKED")) {
    await createNotification(db, {
      userId: adopterId,
      type: "VISIT_VOIDED_ADOPTER_BLOCKED",
      params: { petName: visit.petName, startsAt: visit.startsAt, shelterName },
      link: { visitId: visit.id },
    });
    await audit(db, {
      actorUserId: shelterId,
      action: "VISIT_VOIDED",
      entityType: "Visit",
      entityId: visit.id,
      details: { before: { status: visit.previousStatus }, after: { status: "VOIDED", voidReason: "ADOPTER_BLOCKED" } },
    });
  }

  for (const adoption of await voidPendingAdoptions(db, adopterId, shelterId, "ADOPTER_BLOCKED")) {
    await createNotification(db, {
      userId: adopterId,
      type: "ADOPTION_VOIDED_ADOPTER_BLOCKED",
      params: { petName: adoption.petName, shelterName },
      link: { adoptionId: adoption.id },
    });
    await audit(db, {
      actorUserId: shelterId,
      action: "ADOPTION_VOIDED",
      entityType: "Adoption",
      entityId: adoption.id,
      details: { before: { status: "PENDING" }, after: { status: "VOIDED", voidReason: "ADOPTER_BLOCKED" } },
    });
  }

  for (const adoption of await cancelApprovedAdoptions(db, adopterId, shelterId, "SHELTER")) {
    await createNotification(db, {
      userId: adopterId,
      type: "ADOPTION_CANCELLED_ADOPTER_BLOCKED",
      params: { petName: adoption.petName, shelterName },
      link: { adoptionId: adoption.id },
    });
    await audit(db, {
      actorUserId: shelterId,
      action: "ADOPTION_CANCELLED",
      entityType: "Adoption",
      entityId: adoption.id,
      details: { before: { status: "APPROVED" }, after: { status: "CANCELLED", cancelledBy: "SHELTER" } },
    });
    if (await releaseReservedPet(db, adoption.petId)) {
      await audit(db, {
        actorUserId: shelterId,
        action: "PET_STATUS_CHANGED",
        entityType: "Pet",
        entityId: adoption.petId,
        details: { before: { status: "RESERVED" }, after: { status: "AVAILABLE" } },
      });
      for (const userId of await selectNotSelectedAdopters(db, adoption.petId)) {
        await createNotification(db, { userId, type: "PET_AVAILABLE_AGAIN", params: { petName: adoption.petName }, link: { petId: adoption.petId } });
      }
    }
  }
}

/**
 * CU-35: the shelter blocks an adopter who has sent it some request (RN-145, RN-146), with an
 * internal reason (RN-147). RN-201: the first block of this shelter to this adopter lasts the
 * configured days; any later one is permanent. In one transaction (RN-171) with its effects
 * (RN-148), the adopter's notification (RN-149) and the audit entry (RN-208).
 */
export async function blockAdopter(shelterId: number, adopterId: number, reason: BlockReason, detail: string | null): Promise<Block> {
  const days = getConfig().rules.firstBlockDurationDays;
  return withTransaction(async (client) => {
    await ensureKnownAdopter(client, shelterId, adopterId);
    if (await selectActiveBlockOfPair(client, shelterId, adopterId)) throw new ConflictError(ALREADY_BLOCKED);
    const permanent = await hasBlockedBefore(client, shelterId, adopterId);
    const block = await insertBlockIfNoneActive(client, { shelterId, adopterId, reason, detail, durationDays: permanent ? null : days });
    if (!block) throw new ConflictError(ALREADY_BLOCKED);

    await audit(client, {
      actorUserId: shelterId,
      action: "ADOPTER_BLOCKED",
      entityType: "Block",
      entityId: block.id,
      details: { after: { adopterId, reason, endsAt: block.endsAt } },
    });
    const shelterName = await selectShelterName(client, shelterId);
    await createNotification(client, { userId: adopterId, type: "ADOPTER_BLOCKED", params: { shelterName, endsAt: block.endsAt } });
    await applyBlockEffects(client, shelterId, shelterName, adopterId);
    return block;
  });
}

/** CU-35, RN-150: the shelter lifts the active block early; it stays in the history. */
export async function unblockAdopter(shelterId: number, adopterId: number): Promise<void> {
  await withTransaction(async (client) => {
    await ensureKnownAdopter(client, shelterId, adopterId);
    const block = await selectActiveBlockOfPair(client, shelterId, adopterId, true);
    if (!block) throw new ConflictError(NOT_BLOCKED);
    await liftBlock(client, block.id, "SHELTER");
    await audit(client, {
      actorUserId: shelterId,
      action: "ADOPTER_UNBLOCKED",
      entityType: "Block",
      entityId: block.id,
      details: { before: { liftedAt: null }, after: { liftedBy: "SHELTER" } },
    });
    await createNotification(client, { userId: adopterId, type: "BLOCK_LIFTED", params: { shelterName: await selectShelterName(client, shelterId) } });
  });
}

/**
 * CU-56, RN-202 (scheduled job): lifts the temporary blocks that reached their end and tells
 * the adopter. What the block voided is not recovered. Idempotent. Returns how many.
 */
export async function liftExpiredBlocks(): Promise<number> {
  return withTransaction(async (client) => {
    const lifted = await liftExpiredTemporaryBlocks(client);
    for (const block of lifted) {
      await audit(client, {
        actorUserId: null,
        action: "ADOPTER_UNBLOCKED",
        entityType: "Block",
        entityId: block.id,
        details: { before: { liftedAt: null }, after: { liftedBy: "SYSTEM" } },
      });
      await createNotification(client, { userId: block.adopterId, type: "BLOCK_LIFTED", params: { shelterName: block.shelterName } });
    }
    return lifted.length;
  });
}
