/**
 * Client-only conversation history for the seeker AI assistant.
 * Persists in localStorage scoped by authenticated user id.
 * Does not store secrets, API keys, or raw file bytes.
 */

export type AssistantHistoryAttachmentMeta = {
  name: string;
  mime: string;
  sizeBytes: number;
  kind?: "pdf" | "image" | "docx";
};

export type AssistantHistoryMessage = {
  id: string;
  question: string;
  /** Serialized AskJobAssistantResult JSON — avoid storing secrets there. */
  result: unknown;
  attachment?: AssistantHistoryAttachmentMeta | null;
  createdAt: string;
};

export type AssistantConversation = {
  id: string;
  title: string;
  updatedAt: string;
  messages: AssistantHistoryMessage[];
};

export type AssistantHistoryStore = {
  version: 1;
  conversations: AssistantConversation[];
};

const STORE_VERSION = 1 as const;
const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES = 40;

export function assistantHistoryKey(userId: string): string {
  return `hirehub.assistant.history.v1.${userId}`;
}

export function titleFromQuestion(question: string): string {
  const cleaned = question.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 48) return cleaned || "New conversation";
  return `${cleaned.slice(0, 45).trimEnd()}…`;
}

export function createConversationId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyHistoryStore(): AssistantHistoryStore {
  return { version: STORE_VERSION, conversations: [] };
}

export function readAssistantHistory(userId: string): AssistantHistoryStore {
  if (typeof window === "undefined" || !userId) return emptyHistoryStore();
  try {
    const raw = window.localStorage.getItem(assistantHistoryKey(userId));
    if (!raw) return emptyHistoryStore();
    const parsed = JSON.parse(raw) as AssistantHistoryStore;
    if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.conversations)) {
      return emptyHistoryStore();
    }
    return {
      version: STORE_VERSION,
      conversations: parsed.conversations.slice(0, MAX_CONVERSATIONS),
    };
  } catch {
    return emptyHistoryStore();
  }
}

export function writeAssistantHistory(userId: string, store: AssistantHistoryStore): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    const trimmed: AssistantHistoryStore = {
      version: STORE_VERSION,
      conversations: store.conversations.slice(0, MAX_CONVERSATIONS).map((c) => ({
        ...c,
        messages: c.messages.slice(-MAX_MESSAGES),
      })),
    };
    window.localStorage.setItem(assistantHistoryKey(userId), JSON.stringify(trimmed));
  } catch {
    // Quota / private mode — ignore; chat still works in-memory.
  }
}

export function upsertConversation(
  store: AssistantHistoryStore,
  conversation: AssistantConversation,
): AssistantHistoryStore {
  const others = store.conversations.filter((c) => c.id !== conversation.id);
  return {
    version: STORE_VERSION,
    conversations: [conversation, ...others].slice(0, MAX_CONVERSATIONS),
  };
}

export function deleteConversation(
  store: AssistantHistoryStore,
  conversationId: string,
): AssistantHistoryStore {
  return {
    version: STORE_VERSION,
    conversations: store.conversations.filter((c) => c.id !== conversationId),
  };
}

export function renameConversation(
  store: AssistantHistoryStore,
  conversationId: string,
  title: string,
): AssistantHistoryStore {
  const nextTitle = title.replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled";
  return {
    version: STORE_VERSION,
    conversations: store.conversations.map((c) =>
      c.id === conversationId ? { ...c, title: nextTitle, updatedAt: new Date().toISOString() } : c,
    ),
  };
}
