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
