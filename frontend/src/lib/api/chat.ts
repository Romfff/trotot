import { managementRequest } from "./client";
import type { ApiEnvelope } from "@/lib/auth-types";
import type { Page } from "./homestays";

export type Conversation = {
  id: string; propertyId: string; title: string;
  guest: { id: string; fullName: string }; host: { id: string; fullName: string };
  createdAt: string; canSend: boolean; readOnlyReason: string | null;
};
export type ChatMessage = { id: string; conversationId: string; senderId: string; clientMessageId: string; text: string; createdAt: string };
export type MessagePage = { conversation: Conversation; messages: ChatMessage[]; nextCursor: string | null };
export type ChatUnread = { totalUnread: number; conversations: { conversationId: string; unreadCount: number }[] };
export const chatApi = {
  open: async (propertyId: string, signal?: AbortSignal) => (await managementRequest<ApiEnvelope<Conversation>>("/conversations", { method: "POST", data: { propertyId }, signal })).data,
  list: (page: number, signal?: AbortSignal) => managementRequest<Page<Conversation>>("/conversations", { params: { page, limit: 20 }, signal }),
  unread: async (signal?: AbortSignal) => (await managementRequest<ApiEnvelope<ChatUnread>>("/conversations/unread", { signal })).data,
  markRead: async (id: string, messageId: string, signal?: AbortSignal) => (await managementRequest<ApiEnvelope<{conversationId: string; messageId: string}>>(`/conversations/${encodeURIComponent(id)}/read`, { method: "POST", data: { messageId }, signal })).data,
  messages: async (id: string, before: string | null, signal?: AbortSignal) => (await managementRequest<ApiEnvelope<MessagePage>>(`/conversations/${encodeURIComponent(id)}/messages`, { params: { limit: 20, ...(before ? { before } : {}) }, signal })).data,
  send: async (id: string, input: { clientMessageId: string; text: string }, signal?: AbortSignal) => (await managementRequest<ApiEnvelope<ChatMessage>>(`/conversations/${encodeURIComponent(id)}/messages`, { method: "POST", data: input, signal })).data,
};

export function chronologicalMessages(pages: MessagePage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const page of pages) for (const message of page.messages) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
