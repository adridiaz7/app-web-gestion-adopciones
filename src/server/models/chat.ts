import type { Db } from "../db/transaction.js";

/** A conversation as one of its parties sees it. */
export interface ConversationForUser {
  id: number;
  adopterId: number;
  shelterId: number;
  otherName: string;
  /** RN-13: the other party deleted their account. */
  otherDeleted: boolean;
  /** RN-136, RN-198: whether the pair has an active block (blockEndsAt null: permanent). */
  blocked: boolean;
  blockEndsAt: Date | null;
}

const CONVERSATION_COLUMNS = `
  c.id, c.adopter_id AS "adopterId", c.shelter_id AS "shelterId",
  CASE WHEN $1 = c.adopter_id THEN s.name ELSE a.first_name || ' ' || a.last_name END AS "otherName",
  (CASE WHEN $1 = c.adopter_id THEN su.deleted_at ELSE au.deleted_at END) IS NOT NULL AS "otherDeleted",
  b.id IS NOT NULL AS blocked, b.ends_at AS "blockEndsAt"`;
const CONVERSATION_FROM = `
  FROM "Conversation" c
  JOIN "Adopter"  a  ON a.user_id = c.adopter_id
  JOIN "App_user" au ON au.id = c.adopter_id
  JOIN "Shelter"  s  ON s.user_id = c.shelter_id
  JOIN "App_user" su ON su.id = c.shelter_id
  LEFT JOIN "Block" b ON b.shelter_id = c.shelter_id AND b.adopter_id = c.adopter_id AND b.lifted_at IS NULL`;

/** A conversation in the user's list, with its last message and how many are unread. */
export interface ConversationListRow extends ConversationForUser {
  lastMessage: string | null;
  lastMessageHasPhoto: boolean;
  lastMessageAt: Date | null;
  unread: number;
}

/** CU-33: the user's conversations (as adopter or shelter), the most recent activity first. */
export async function selectUserConversations(db: Db, userId: number): Promise<ConversationListRow[]> {
  const { rows } = await db.query<ConversationListRow>(
    `SELECT ${CONVERSATION_COLUMNS},
            last.body AS "lastMessage", last.attachment_path IS NOT NULL AS "lastMessageHasPhoto", last.created_at AS "lastMessageAt",
            (SELECT count(*)::int FROM "Message" m
              WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread
       ${CONVERSATION_FROM}
       LEFT JOIN LATERAL (SELECT m.body, m.attachment_path, m.created_at FROM "Message" m
                           WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) last ON true
      WHERE $1 IN (c.adopter_id, c.shelter_id)
      ORDER BY coalesce(last.created_at, c.created_at) DESC, c.id DESC`,
    [userId],
  );
  return rows;
}

/** The conversation if the user is one of its parties, or null. */
export async function selectConversationForUser(db: Db, userId: number, conversationId: number): Promise<ConversationForUser | null> {
  const { rows } = await db.query<ConversationForUser>(
    `SELECT ${CONVERSATION_COLUMNS} ${CONVERSATION_FROM}
      WHERE c.id = $2 AND $1 IN (c.adopter_id, c.shelter_id)`,
    [userId, conversationId],
  );
  return rows[0] ?? null;
}

export interface MessageRow {
  id: number;
  senderId: number;
  /** RN-13: "Usuario eliminado" when the sender's account is deleted. */
  senderName: string;
  body: string | null;
  photoUrl: string | null;
  readAt: Date | null;
  createdAt: Date;
}

const MESSAGE_SELECT = `
  SELECT m.id, m.sender_id AS "senderId",
         CASE WHEN u.deleted_at IS NOT NULL THEN 'Usuario eliminado'
              ELSE coalesce(s.name, a.first_name || ' ' || a.last_name) END AS "senderName",
         m.body, m.attachment_path AS "photoUrl", m.read_at AS "readAt", m.created_at AS "createdAt"
    FROM "Message" m
    JOIN "App_user" u ON u.id = m.sender_id
    LEFT JOIN "Shelter" s ON s.user_id = m.sender_id
    LEFT JOIN "Adopter" a ON a.user_id = m.sender_id`;

/** CU-33: the conversation's messages after `afterId` (0: all), oldest first. */
export async function selectMessages(db: Db, conversationId: number, afterId: number): Promise<MessageRow[]> {
  const { rows } = await db.query<MessageRow>(`${MESSAGE_SELECT} WHERE m.conversation_id = $1 AND m.id > $2 ORDER BY m.id`, [
    conversationId,
    afterId,
  ]);
  return rows;
}

export async function selectMessage(db: Db, messageId: number): Promise<MessageRow | null> {
  const { rows } = await db.query<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = $1`, [messageId]);
  return rows[0] ?? null;
}

/** RN-138: the other party's unread messages are marked as read now. */
export async function markMessagesRead(db: Db, conversationId: number, readerId: number): Promise<void> {
  await db.query(`UPDATE "Message" SET read_at = now() WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL`, [
    conversationId,
    readerId,
  ]);
}

/** RN-139: text or a photo (stored as its path, RN-52). */
export async function insertMessage(db: Db, conversationId: number, senderId: number, body: string | null, photoUrl: string | null): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO "Message" (conversation_id, sender_id, body, attachment_path, attachment_type)
     VALUES ($1, $2, $3, $4::text, CASE WHEN $4::text IS NULL THEN NULL ELSE 'IMAGE' END) RETURNING id`,
    [conversationId, senderId, body, photoUrl],
  );
  const row = rows[0];
  if (!row) throw new Error("insertMessage: no row returned");
  return row.id;
}
