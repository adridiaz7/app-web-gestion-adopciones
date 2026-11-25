import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { ChatMessageResponse, ConversationMessagesResponse, ConversationsResponse } from "../../shared/api.js";
import { BadRequestError, UnauthorizedError } from "../errors.js";
import { listConversations, readConversation, sendPhoto, sendText, type ChatMessage } from "../services/chat.js";

const INVALID = "La conversación no es válida.";
const paramsSchema = z.object({
  id: z.coerce.number({ error: INVALID }).int({ error: INVALID }).positive({ error: INVALID }).max(Number.MAX_SAFE_INTEGER, { error: INVALID }),
});
const AFTER = "El último mensaje no es válido.";
const pollSchema = z.object({
  after: z.coerce.number({ error: AFTER }).int({ error: AFTER }).min(0, { error: AFTER }).max(Number.MAX_SAFE_INTEGER, { error: AFTER }).default(0),
});
const WRITE = "Escribe un mensaje.";
const textSchema = z.object({
  body: z.string({ error: WRITE }).trim().min(1, { error: WRITE }).max(2000, { error: "El mensaje no puede tener más de 2000 caracteres." }),
});

function userId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

const messageBody = (m: ChatMessage): ChatMessageResponse["message"] => ({ ...m, createdAt: m.createdAt.toISOString() });

/** CU-33 · GET /api/conversations */
export const getConversations: RequestHandler = async (req, res) => {
  const conversations = await listConversations(userId(req.user));
  const body: ConversationsResponse = {
    conversations: conversations.map((c) => ({ ...c, lastMessageAt: c.lastMessageAt?.toISOString() ?? null })),
  };
  res.json(body);
};

/** CU-33 · GET /api/conversations/:id/messages?after=<id of the last message the screen has> */
export const getMessages: RequestHandler = async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  const { after } = pollSchema.parse(req.query);
  const { conversation, messages } = await readConversation(userId(req.user), id, after);
  const body: ConversationMessagesResponse = { conversation, messages: messages.map(messageBody) };
  res.json(body);
};

/** CU-33 · POST /api/conversations/:id/messages */
export const postMessage: RequestHandler = async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  const { body: text } = textSchema.parse(req.body ?? {});
  const body: ChatMessageResponse = { message: messageBody(await sendText(userId(req.user), id, text)) };
  res.status(201).json(body);
};

/** CU-33, RN-139 · POST /api/conversations/:id/photos (multipart, field "photo") */
export const postChatPhoto: RequestHandler = async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  if (!req.file) throw new BadRequestError("Elige una foto.");
  const body: ChatMessageResponse = { message: messageBody(await sendPhoto(userId(req.user), id, req.file.buffer)) };
  res.status(201).json(body);
};
