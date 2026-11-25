import type { Db } from "../db/transaction.js";

export interface NotificationInsert {
  userId: number;
  type: string;
  title: string;
  body: string;
  visitId: number | null;
  adoptionId: number | null;
  petId: number | null;
  incidentId: number | null;
}

export async function insertNotification(db: Db, n: NotificationInsert): Promise<{ id: number }> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO "Notification" (user_id, type, title, body, visit_id, adoption_id, pet_id, incident_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [n.userId, n.type, n.title, n.body, n.visitId, n.adoptionId, n.petId, n.incidentId],
  );
  const row = rows[0];
  if (!row) throw new Error("insertNotification: no row returned");
  return row;
}

/** CU-34: a notification as its user sees it. */
export interface NotificationRow {
  id: number;
  type: string;
  title: string;
  body: string;
  visitId: number | null;
  adoptionId: number | null;
  petId: number | null;
  incidentId: number | null;
  readAt: Date | null;
  createdAt: Date;
}

/** CU-34: the user's latest notifications, newest first. */
export async function selectUserNotifications(db: Db, userId: number, limit: number): Promise<NotificationRow[]> {
  const { rows } = await db.query<NotificationRow>(
    `SELECT id, type, title, body, visit_id AS "visitId", adoption_id AS "adoptionId", pet_id AS "petId",
            incident_id AS "incidentId", read_at AS "readAt", created_at AS "createdAt"
       FROM "Notification"
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

export async function countUnread(db: Db, userId: number): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "Notification" WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  return rows[0]?.n ?? 0;
}

/** CU-34: marks the user's unread notifications (or only `notificationId`) as read. Returns how many of the user's matched. */
export async function markRead(db: Db, userId: number, notificationId: number | null = null): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE "Notification" SET read_at = coalesce(read_at, now())
      WHERE user_id = $1 AND ($2::bigint IS NULL OR id = $2)`,
    [userId, notificationId],
  );
  return rowCount ?? 0;
}
