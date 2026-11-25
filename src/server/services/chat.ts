import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { withTransaction, type Db } from "../db/transaction.js";
import { BadRequestError, ConflictError, NotFoundError } from "../errors.js";
import {
  insertMessage,
  markMessagesRead,
  selectConversationForUser,
  selectMessage,
  selectMessages,
  selectUserConversations,
  type ConversationForUser,
  type MessageRow,
} from "../models/chat.js";
import { imageExtension } from "./pet-photos.js";

const NOT_FOUND = "La conversación no existe.";
const DELETED_NAME = "Usuario eliminado";
const madridDay = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long", year: "numeric" });

export interface ConversationSummary {
  id: number;
  otherName: string;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  unread: number;
  canWrite: boolean;
}

export interface ConversationHeader {
  id: number;
  otherName: string;
  canWrite: boolean;
  /** RN-198, RN-13: fixed notice of why nobody can write, or null. */
  notice: string | null;
}

export interface ChatMessage {
  id: number;
  mine: boolean;
  senderName: string;
  body: string | null;
  photoUrl: string | null;
  read: boolean;
  createdAt: Date;
}

/** RN-13: a deleted account shows as "Usuario eliminado". */
const otherName = (c: ConversationForUser): string => (c.otherDeleted ? DELETED_NAME : c.otherName);

/** RN-136, RN-13: nobody writes during an active block or once the other party deleted their account. */
const canWrite = (c: ConversationForUser): boolean => !c.blocked && !c.otherDeleted;

/** RN-198: a fixed notice for both parties, with the end date of a temporary block; RN-13 for a deleted account. */
function noticeFor(c: ConversationForUser, userId: number): string | null {
  if (c.blocked) {
    const until = c.blockEndsAt ? ` hasta el ${madridDay.format(c.blockEndsAt)}` : "";
    const who = userId === c.adopterId ? "Esta protectora te ha bloqueado" : "Has bloqueado a este adoptante";
    return `${who}${until}. Mientras tanto, ninguna de las partes puede escribir en la conversación.`;
  }
  if (c.otherDeleted) return "La otra parte ha eliminado su cuenta. Puedes leer la conversación, pero ya no escribir en ella.";
  return null;
}

const toMessage = (row: MessageRow, userId: number): ChatMessage => ({
  id: row.id,
  mine: row.senderId === userId,
  senderName: row.senderName,
  body: row.body,
  photoUrl: row.photoUrl,
  read: row.readAt !== null,
  createdAt: row.createdAt,
});

/** CU-33, RN-133: the user's conversations, one per adopter–shelter pair. */
export async function listConversations(userId: number): Promise<ConversationSummary[]> {
  const rows = await selectUserConversations(getPool(), userId);
  return rows.map((row) => ({
    id: row.id,
    otherName: otherName(row),
    lastMessage: row.lastMessage ?? (row.lastMessageHasPhoto ? "Foto" : null),
    lastMessageAt: row.lastMessageAt,
    unread: row.unread,
    canWrite: canWrite(row),
  }));
}

async function conversationOf(db: Db, userId: number, conversationId: number): Promise<ConversationForUser> {
  const conversation = await selectConversationForUser(db, userId, conversationId);
  if (!conversation) throw new NotFoundError(NOT_FOUND);
  return conversation;
}

/**
 * CU-33: the conversation's messages (only those after `afterId`, for polling). Both parties
 * can always read it (RN-135, RN-136). RN-138: the other party's messages become read.
 */
export async function readConversation(
  userId: number,
  conversationId: number,
  afterId: number,
): Promise<{ conversation: ConversationHeader; messages: ChatMessage[] }> {
  return withTransaction(async (client) => {
    const conversation = await conversationOf(client, userId, conversationId);
    const rows = await selectMessages(client, conversationId, afterId);
    await markMessagesRead(client, conversationId, userId);
    return {
      conversation: {
        id: conversationId,
        otherName: otherName(conversation),
        canWrite: canWrite(conversation),
        notice: noticeFor(conversation, userId),
      },
      messages: rows.map((row) => toMessage(row, userId)),
    };
  });
}

/** RN-136, RN-13: why the user cannot write, if they cannot. */
function checkCanWrite(conversation: ConversationForUser): void {
  if (conversation.blocked) throw new ConflictError("Mientras dure el bloqueo no se pueden enviar mensajes.");
  if (conversation.otherDeleted) throw new ConflictError("La otra parte ha eliminado su cuenta: ya no se puede escribir en esta conversación.");
}

/**
 * CU-33, RN-139: sends a text message to an existing conversation. There is no way to start
 * one: it only opens with a visit request (RN-134), so a shelter cannot start it.
 */
export async function sendText(userId: number, conversationId: number, body: string): Promise<ChatMessage> {
  return withTransaction(async (client) => {
    checkCanWrite(await conversationOf(client, userId, conversationId));
    const message = await selectMessage(client, await insertMessage(client, conversationId, userId, body, null));
    if (!message) throw new Error("message not found after sending it");
    return toMessage(message, userId);
  });
}

/**
 * CU-33, RN-139: sends a photo. Same checks as the pet photos (JPEG, PNG or WebP by content,
 * size limited by multer); saved under a random name and only its path is stored (RN-52).
 */
export async function sendPhoto(userId: number, conversationId: number, file: Buffer): Promise<ChatMessage> {
  const extension = imageExtension(file);
  if (!extension) throw new BadRequestError("La foto tiene que ser una imagen JPEG, PNG o WebP.");
  const { uploadsDir } = getConfig();
  const name = `${randomUUID()}.${extension}`;
  let written = false;
  try {
    return await withTransaction(async (client) => {
      checkCanWrite(await conversationOf(client, userId, conversationId));
      await mkdir(uploadsDir, { recursive: true });
      await writeFile(join(uploadsDir, name), file);
      written = true;
      const message = await selectMessage(client, await insertMessage(client, conversationId, userId, null, `/uploads/${name}`));
      if (!message) throw new Error("message not found after sending it");
      return toMessage(message, userId);
    });
  } catch (error) {
    if (written) await rm(join(uploadsDir, name), { force: true });
    throw error;
  }
}
