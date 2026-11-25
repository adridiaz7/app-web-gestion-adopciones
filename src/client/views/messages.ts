import type { ChatMessage, ConversationMessagesResponse, ConversationSummary } from "../../shared/api.js";
import { currentUser } from "../api/auth.js";
import { getMessages, listConversations, sendChatPhoto, sendMessage } from "../api/chat.js";
import { ApiError } from "../api/client.js";
import { appLayout } from "../components/app-layout.js";
import { navFor } from "../components/nav.js";
import { notice } from "../components/notice.js";
import { h, mount, queryParam } from "../dom.js";
import { madridTime } from "../madrid-time.js";
import { navigate } from "../router.js";

/** How often an open conversation asks for new messages (specifications §5: polling). */
const POLL_MS = 5 * 1000;

const SHORT_DAY = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "short" });
const errorText = (error: unknown, fallback: string): string => (error instanceof ApiError ? error.message : fallback);

/** Initials of a name for the avatar circle. */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");

function conversationLink(conversation: ConversationSummary, current: boolean): HTMLElement {
  const when = conversation.lastMessageAt ? SHORT_DAY.format(new Date(conversation.lastMessageAt)) : "";
  return h(
    "a",
    { class: `chat-list__item${current ? " chat-list__item--current" : ""}`, href: `/mensajes?c=${String(conversation.id)}`, "aria-current": current ? "page" : undefined },
    h("span", { class: "avatar", "aria-hidden": "true" }, initials(conversation.otherName)),
    h(
      "span",
      { class: "chat-list__text" },
      h("strong", {}, conversation.otherName),
      h("span", { class: "muted chat-list__preview" }, conversation.lastMessage ?? "Sin mensajes todavía"),
    ),
    h(
      "span",
      { class: "chat-list__meta" },
      h("span", { class: "muted" }, when),
      conversation.unread > 0 ? h("span", { class: "chat-list__unread" }, String(conversation.unread)) : null,
    ),
  );
}

function messageBubble(message: ChatMessage): HTMLElement {
  return h(
    "div",
    { class: `chat-message${message.mine ? " chat-message--mine" : ""}` },
    message.mine ? null : h("p", { class: "chat-message__sender" }, message.senderName),
    message.photoUrl ? h("img", { class: "chat-message__photo", src: message.photoUrl, alt: "Foto enviada en el chat" }) : null,
    message.body ? h("p", { class: "chat-message__body" }, message.body) : null,
    h(
      "p",
      { class: "chat-message__time" },
      `${SHORT_DAY.format(new Date(message.createdAt))}, ${madridTime(message.createdAt)}${message.mine && message.read ? " · Leído" : ""}`,
    ),
  );
}

/**
 * CU-33: one open conversation. It polls for new messages while it is on the page. The form
 * is hidden when nobody can write (RN-136, RN-13), and the fixed notice is shown (RN-198).
 */
function conversationPanel(id: number, first: ConversationMessagesResponse): HTMLElement {
  const list = h("div", { class: "chat-thread__messages" }, ...first.messages.map(messageBubble));
  let lastId = first.messages.at(-1)?.id ?? 0;
  const message = h("div", {});

  const append = (messages: ChatMessage[]): void => {
    const fresh = messages.filter((m) => m.id > lastId);
    if (fresh.length === 0) return;
    list.append(...fresh.map(messageBubble));
    lastId = fresh.at(-1)?.id ?? lastId;
    list.scrollTop = list.scrollHeight;
  };

  const panel = h(
    "section",
    { class: "chat-thread" },
    h("header", { class: "chat-thread__header" }, h("span", { class: "avatar", "aria-hidden": "true" }, initials(first.conversation.otherName)), h("strong", {}, first.conversation.otherName)),
    first.conversation.notice ? notice("warning", first.conversation.notice) : null,
    list,
    message,
  );

  if (first.conversation.canWrite) {
    const text = h("input", { type: "text", name: "body", maxlength: "2000", placeholder: "Escribe un mensaje…", "aria-label": "Mensaje", autocomplete: "off" });
    const photo = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", class: "visually-hidden", id: "chat-photo" });
    const send = h("button", { type: "submit", class: "button button--primary" }, "Enviar");
    const form = h(
      "form",
      { class: "chat-thread__form" },
      h("label", { class: "button button--secondary", for: "chat-photo", title: "Enviar una foto" }, "Foto"),
      photo,
      text,
      send,
    );
    const done = (sent: ChatMessage): void => {
      message.replaceChildren();
      append([sent]);
    };
    const fail = (error: unknown): void => {
      message.replaceChildren(notice("error", errorText(error, "No se ha podido enviar el mensaje.")));
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const body = text.value.trim();
      if (!body) return;
      send.disabled = true;
      sendMessage(id, { body })
        .then(({ message: sent }) => {
          text.value = "";
          done(sent);
        }, fail)
        .finally(() => {
          send.disabled = false;
        });
    });
    photo.addEventListener("change", () => {
      const file = photo.files?.[0];
      if (!file) return;
      sendChatPhoto(id, file).then(({ message: sent }) => {
        done(sent);
      }, fail);
      photo.value = "";
    });
    panel.append(form);
  }

  const timer = window.setInterval(() => {
    if (!panel.isConnected) {
      window.clearInterval(timer);
      return;
    }
    getMessages(id, lastId).then(({ messages }) => {
      append(messages);
    }, () => undefined);
  }, POLL_MS);

  queueMicrotask(() => {
    list.scrollTop = list.scrollHeight;
  });
  return panel;
}

/** CU-33 · /mensajes: the user's conversations and, with ?c=<id>, one of them. */
export async function renderMessages(root: HTMLElement): Promise<void> {
  const user = await currentUser();
  if (!user) {
    navigate("/iniciar-sesion", { replace: true });
    return;
  }
  if (user.role !== "ADOPTER" && user.role !== "SHELTER") {
    navigate("/inicio", { replace: true });
    return;
  }

  const selected = Number(queryParam("c")) || null;
  let content: Node;
  try {
    const { conversations } = await listConversations();
    const listPanel = h(
      "nav",
      { class: "chat-list", "aria-label": "Conversaciones" },
      ...(conversations.length === 0
        ? [
            notice(
              "info",
              "Todavía no tienes conversaciones.",
              user.role === "ADOPTER" ? "La conversación con una protectora se abre al solicitar tu primera visita." : "Se abren cuando un adoptante solicita una visita.",
            ),
          ]
        : conversations.map((conversation) => conversationLink(conversation, conversation.id === selected))),
    );
    let right: Node = h("div", { class: "chat-thread chat-thread--empty" }, h("p", { class: "muted" }, "Elige una conversación."));
    if (selected) {
      try {
        right = conversationPanel(selected, await getMessages(selected));
      } catch (error) {
        right = h("div", { class: "chat-thread chat-thread--empty" }, notice("error", errorText(error, "No se ha podido abrir la conversación.")));
      }
    }
    content = h("div", { class: "card chat" }, listPanel, right);
  } catch (error) {
    content = notice("error", errorText(error, "No se han podido cargar tus conversaciones."));
  }

  mount(
    root,
    appLayout(user, navFor(user.role), [
      h("h1", { class: "display" }, "Mensajes"),
      h("p", { class: "muted" }, user.role === "ADOPTER" ? "Una conversación por protectora." : "Una conversación por adoptante."),
      content,
    ]),
  );
}
