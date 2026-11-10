/**
 * Client-only conversation history for the Recruiter Agent chat.
 * Persists in localStorage scoped by authenticated user id.
 * Does not store secrets or JWT material.
 */

import type { RecruiterChatTurn } from "@/lib/ai/recruiter-agent-ui";

export type RecruiterAgentConversation = {
  id: string;
  title: string;
  updatedAt: string;
  turns: RecruiterChatTurn[];
};

export type RecruiterAgentHistoryStore = {
  version: 1;
  conversations: RecruiterAgentConversation[];
};

const STORE_VERSION = 1 as const;
const MAX_CONVERSATIONS = 30;
const MAX_TURNS = 80;

export function recruiterAgentHistoryKey(userId: string): string {
  return `hirehub.recruiter-agent.history.v1.${userId}`;
}

export function titleFromRecruiterTurn(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 48) return cleaned || "New conversation";
  return `${cleaned.slice(0, 45).trimEnd()}…`;
}

export function createRecruiterConversationId(): string {
  return `rc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyRecruiterHistoryStore(): RecruiterAgentHistoryStore {
  return { version: STORE_VERSION, conversations: [] };
}

export function readRecruiterAgentHistory(userId: string): RecruiterAgentHistoryStore {
  if (typeof window === "undefined" || !userId) return emptyRecruiterHistoryStore();
  try {
    const raw = window.localStorage.getItem(recruiterAgentHistoryKey(userId));
    if (!raw) return emptyRecruiterHistoryStore();
    const parsed = JSON.parse(raw) as RecruiterAgentHistoryStore;
    if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.conversations)) {
      return emptyRecruiterHistoryStore();
    }
    return {
      version: STORE_VERSION,
      conversations: parsed.conversations.slice(0, MAX_CONVERSATIONS),
    };
  } catch {
    return emptyRecruiterHistoryStore();
  }
}

export function writeRecruiterAgentHistory(
  userId: string,
  store: RecruiterAgentHistoryStore,
): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    const trimmed: RecruiterAgentHistoryStore = {
      version: STORE_VERSION,
      conversations: store.conversations.slice(0, MAX_CONVERSATIONS).map((c) => ({
        ...c,
        turns: c.turns.slice(-MAX_TURNS),
      })),
    };
    window.localStorage.setItem(recruiterAgentHistoryKey(userId), JSON.stringify(trimmed));
  } catch {
    // Quota / private mode — ignore; chat still works in-memory.
  }
}

export function upsertRecruiterConversation(
  store: RecruiterAgentHistoryStore,
  conversation: RecruiterAgentConversation,
): RecruiterAgentHistoryStore {
  const others = store.conversations.filter((c) => c.id !== conversation.id);
  return {
    version: STORE_VERSION,
    conversations: [conversation, ...others].slice(0, MAX_CONVERSATIONS),
  };
}

export function deleteRecruiterConversation(
  store: RecruiterAgentHistoryStore,
  conversationId: string,
): RecruiterAgentHistoryStore {
  return {
    version: STORE_VERSION,
    conversations: store.conversations.filter((c) => c.id !== conversationId),
  };
}

export function renameRecruiterConversation(
  store: RecruiterAgentHistoryStore,
  conversationId: string,
  title: string,
): RecruiterAgentHistoryStore {
  const nextTitle = title.replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled";
  return {
    version: STORE_VERSION,
    conversations: store.conversations.map((c) =>
      c.id === conversationId ? { ...c, title: nextTitle, updatedAt: new Date().toISOString() } : c,
    ),
  };
}
