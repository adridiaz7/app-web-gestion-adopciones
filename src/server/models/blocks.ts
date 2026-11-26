import type { Db } from "../db/transaction.js";

export type BlockReason = "INAPPROPRIATE_BEHAVIOUR" | "FALSE_INFORMATION" | "BREACHES" | "OTHER";

/** A shelter's block of an adopter. `endsAt` null = permanent (RN-201). */
export interface Block {
  id: number;
  reason: BlockReason;
  detail: string | null;
  createdAt: Date;
  endsAt: Date | null;
}

const BLOCK = `id, reason, detail, created_at AS "createdAt", ends_at AS "endsAt"`;

/** The active block of the pair (RN-151), locked when `forUpdate`. */
export async function selectActiveBlockOfPair(db: Db, shelterId: number, adopterId: number, forUpdate = false): Promise<Block | null> {
  const { rows } = await db.query<Block>(
    `SELECT ${BLOCK} FROM "Block" WHERE shelter_id = $1 AND adopter_id = $2 AND lifted_at IS NULL${forUpdate ? " FOR UPDATE" : ""}`,
    [shelterId, adopterId],
  );
  return rows[0] ?? null;
}

/** RN-201: whether this shelter has ever blocked this adopter (lifted early or not). */
export async function hasBlockedBefore(db: Db, shelterId: number, adopterId: number): Promise<boolean> {
  const { rowCount } = await db.query(`SELECT 1 FROM "Block" WHERE shelter_id = $1 AND adopter_id = $2 LIMIT 1`, [shelterId, adopterId]);
  return rowCount === 1;
}

/**
 * Inserts an active block lasting `durationDays` (null = permanent). Returns null when the
 * pair already has an active block (RN-151: partial unique index), so a concurrent block
 * gets the same answer.
 */
export async function insertBlockIfNoneActive(
  db: Db,
  block: { shelterId: number; adopterId: number; reason: BlockReason; detail: string | null; durationDays: number | null },
): Promise<Block | null> {
  const { rows } = await db.query<Block>(
    `INSERT INTO "Block" (shelter_id, adopter_id, reason, detail, ends_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $5::int IS NOT NULL THEN now() + make_interval(days => $5::int) END)
     ON CONFLICT (shelter_id, adopter_id) WHERE lifted_at IS NULL DO NOTHING
     RETURNING ${BLOCK}`,
    [block.shelterId, block.adopterId, block.reason, block.detail, block.durationDays],
  );
  return rows[0] ?? null;
}

/** RN-150: lifts a block; the row stays as history. */
export async function liftBlock(db: Db, blockId: number, by: "SHELTER" | "SYSTEM"): Promise<void> {
  await db.query(`UPDATE "Block" SET lifted_at = now(), lifted_by = $2 WHERE id = $1 AND lifted_at IS NULL`, [blockId, by]);
}

/** A temporary block lifted by the system. */
export interface LiftedBlock {
  id: number;
  adopterId: number;
  shelterName: string;
}

/** RN-202, CU-56: lifts, by the system, the temporary blocks whose end has come. */
export async function liftExpiredTemporaryBlocks(db: Db): Promise<LiftedBlock[]> {
  const { rows } = await db.query<LiftedBlock>(
    `WITH due AS (
       SELECT id FROM "Block" WHERE lifted_at IS NULL AND ends_at IS NOT NULL AND ends_at <= now() FOR UPDATE SKIP LOCKED
     )
     UPDATE "Block" b SET lifted_at = now(), lifted_by = 'SYSTEM'
       FROM due, "Shelter" s
      WHERE b.id = due.id AND s.user_id = b.shelter_id
     RETURNING b.id, b.adopter_id AS "adopterId", s.name AS "shelterName"`,
  );
  return rows.sort((a, b) => a.id - b.id);
}

/** The shelter's name, for the notifications. */
export async function selectShelterName(db: Db, shelterId: number): Promise<string> {
  const { rows } = await db.query<{ name: string }>(`SELECT name FROM "Shelter" WHERE user_id = $1`, [shelterId]);
  return rows[0]?.name ?? "";
}
