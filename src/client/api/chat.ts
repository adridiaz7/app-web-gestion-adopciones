import type { ChatMessageResponse, ConversationMessagesResponse, ConversationsResponse, SendMessageRequest } from "../../shared/api.js";
import { apiRequest } from "./client.js";

/** CU-33 */
export const listConversations = () => apiRequest<ConversationsResponse>("GET", "/conversations");

/** CU-33: the messages after `after` (0: all); also marks the other party's as read (RN-138). */
export const getMessages = (id: number, after = 0) =>
  apiRequest<ConversationMessagesResponse>("GET", `/conversations/${String(id)}/messages${after > 0 ? `?after=${String(after)}` : ""}`);

/** CU-33 */
export const sendMessage = (id: number, body: SendMessageRequest) =>
  apiRequest<ChatMessageResponse>("POST", `/conversations/${String(id)}/messages`, body);

/** CU-33, RN-139 */
export function sendChatPhoto(id: number, file: File): Promise<ChatMessageResponse> {
  const form = new FormData();
  form.append("photo", file);
  return apiRequest<ChatMessageResponse>("POST", `/conversations/${String(id)}/photos`, form);
}
