import type { Db } from "../db/transaction.js";

export type IncidentReason = "WRONG_ATTENDANCE" | "INAPPROPRIATE_BEHAVIOUR" | "FALSE_INFORMATION" | "INAPPROPRIATE_CONTENT" | "UNFAIR_BLOCK" | "OTHER";

/** The role of an account that is not deleted, or null. */
export async function selectActiveRole(db: Db, userId: number): Promise<"ADOPTER" | "SHELTER" | "ADMIN" | null> {
  const { rows } = await db.query<{ role: "ADOPTER" | "SHELTER" | "ADMIN" }>(`SELECT role FROM "App_user" WHERE id = $1 AND deleted_at IS NULL`, [userId]);
  return rows[0]?.role ?? null;
}

/** CU-36: whether the visit is between this adopter and this shelter. */
export async function isVisitBetween(db: Db, visitId: number, adopterId: number, shelterId: number): Promise<boolean> {
  const { rowCount } = await db.query(`SELECT 1 FROM "Visit" WHERE id = $1 AND adopter_id = $2 AND shelter_id = $3`, [visitId, adopterId, shelterId]);
  return rowCount === 1;
}

/** CU-36: whether the adoption is between this adopter and this shelter. */
export async function isAdoptionBetween(db: Db, adoptionId: number, adopterId: number, shelterId: number): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM "Adoption" a JOIN "Pet" p ON p.id = a.pet_id WHERE a.id = $1 AND a.adopter_id = $2 AND p.shelter_id = $3`,
    [adoptionId, adopterId, shelterId],
  );
  return rowCount === 1;
}

export interface IncidentInsert {
  reporterId: number;
  reportedId: number;
  reason: IncidentReason;
  description: string;
  visitId: number | null;
  adoptionId: number | null;
}

/** RN-168: a new incident starts OPEN (column default). */
export async function insertIncident(db: Db, incident: IncidentInsert): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO "Incident" (reporter_id, reported_id, reason, description, visit_id, adoption_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [incident.reporterId, incident.reportedId, incident.reason, incident.description, incident.visitId, incident.adoptionId],
  );
  const row = rows[0];
  if (!row) throw new Error("insertIncident: no row returned");
  return row.id;
}

export type IncidentStatus = "OPEN" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";

/** CU-37: an incident as the administrator reviews it. */
export interface IncidentForAdmin {
  id: number;
  reporterId: number;
  reporterEmail: string;
  reportedId: number;
  reportedEmail: string;
  reason: IncidentReason;
  description: string;
  visitId: number | null;
  adoptionId: number | null;
  status: IncidentStatus;
  resolution: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

/** CU-37: the incidents with that status, oldest first (or all, newest first). */
export async function selectIncidents(db: Db, status: IncidentStatus | null): Promise<IncidentForAdmin[]> {
  const { rows } = await db.query<IncidentForAdmin>(
    `SELECT i.id, i.reporter_id AS "reporterId", ru.email AS "reporterEmail", i.reported_id AS "reportedId", du.email AS "reportedEmail",
            i.reason, i.description, i.visit_id AS "visitId", i.adoption_id AS "adoptionId", i.status, i.resolution,
            i.resolved_at AS "resolvedAt", i.created_at AS "createdAt"
       FROM "Incident" i
       JOIN "App_user" ru ON ru.id = i.reporter_id
       JOIN "App_user" du ON du.id = i.reported_id
      WHERE $1::text IS NULL OR i.status = $1
      ORDER BY i.created_at, i.id`,
    [status],
  );
  return rows;
}

/** Locks the incident; returns its status and reporter, or null. */
export async function lockIncident(db: Db, id: number): Promise<{ status: IncidentStatus; reporterId: number } | null> {
  const { rows } = await db.query<{ status: IncidentStatus; reporterId: number }>(
    `SELECT status, reporter_id AS "reporterId" FROM "Incident" WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] ?? null;
}

/** RN-168: the new status; a closed one gets its resolution and date. */
export async function updateIncidentStatus(db: Db, id: number, status: IncidentStatus, resolution: string | null): Promise<void> {
  await db.query(
    `UPDATE "Incident" SET status = $2, resolution = $3, resolved_at = CASE WHEN $2 IN ('RESOLVED', 'DISMISSED') THEN now() END WHERE id = $1`,
    [id, status, resolution],
  );
}
