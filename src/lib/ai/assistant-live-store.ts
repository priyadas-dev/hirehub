/**
 * In-memory assistant chat state that survives route changes within the SPA.
 * Completing a request still works if the seeker navigates away mid-answer.
 * Completed turns are also written to localStorage history (no file bytes / secrets).
 */

import type { AskJobAssistantResult } from "@/lib/ai/job-assistant";
import {
  createConversationId,
  readAssistantHistory,
  titleFromQuestion,
  upsertConversation,
  writeAssistantHistory,
  type AssistantHistoryAttachmentMeta,
} from "@/lib/ai/assistant-history";

export type LiveChatTurn = {
  id: string;
  question: string;
  result: AskJobAssistantResult | null;
  pending?: boolean;
  attachment?: AssistantHistoryAttachmentMeta | null;
};

export type AssistantLiveState = {
  userId: string;
  conversationId: string;
  turns: LiveChatTurn[];
  busy: boolean;
  sessionSkills: string[];
  formError: string | null;
  attachStatus: string | null;
};

type Listener = () => void;

const listeners = new Set<Listener>();

let state: AssistantLiveState | null = null;

/** In-flight ask promise — shared so remounted UI can wait on the same request. */
let inflight: Promise<void> | null = null;

function activeKey(userId: string): string {
  return `hirehub.assistant.active.v1.${userId}`;
}

function emit() {
  for (const listener of listeners) listener();
}

export function getAssistantLiveState(): AssistantLiveState | null {
  return state;
}

export function subscribeAssistantLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function patchAssistantLive(partial: Partial<AssistantLiveState>): void {
  if (!state) return;
  state = { ...state, ...partial };
  emit();
}

function persistCompleted(
  userId: string,
  conversationId: string,
  turns: LiveChatTurn[],
  titleSeed?: string,
) {
  const completed = turns.filter((t) => t.result && !t.pending);
  if (!completed.length) return;
  const conversation = {
    id: conversationId,
    title: titleFromQuestion(titleSeed ?? completed[0]?.question ?? "New conversation"),
    updatedAt: new Date().toISOString(),
    messages: completed.map((t) => ({
      id: t.id,
      question: t.question,
      result: t.result,
      attachment: t.attachment ?? null,
      createdAt: new Date().toISOString(),
    })),
  };
  const store = upsertConversation(readAssistantHistory(userId), conversation);
  writeAssistantHistory(userId, store);
  try {
    window.localStorage.setItem(activeKey(userId), conversationId);
  } catch {
    /* ignore */
  }
}

/** Ensure a live store exists for this user (restores last conversation when fresh). */
export function ensureAssistantLiveState(userId: string): AssistantLiveState {
  if (state && state.userId === userId) return state;

  let conversationId = createConversationId();
  let turns: LiveChatTurn[] = [];
  try {
    const activeId = window.localStorage.getItem(activeKey(userId));
    const history = readAssistantHistory(userId);
    const found = activeId
      ? history.conversations.find((c) => c.id === activeId)
      : history.conversations[0];
    if (found) {
      conversationId = found.id;
      turns = found.messages.map((m) => ({
        id: m.id,
        question: m.question,
        result: m.result as AskJobAssistantResult,
        pending: false,
        attachment: m.attachment ?? null,
      }));
    }
  } catch {
    /* ignore */
  }

  state = {
    userId,
    conversationId,
    turns,
    busy: Boolean(inflight),
    sessionSkills: [],
    formError: null,
    attachStatus: null,
  };
  emit();
  return state;
}

export function resetAssistantLiveConversation(userId: string): void {
  if (inflight) return;
  state = {
    userId,
    conversationId: createConversationId(),
    turns: [],
    busy: false,
    sessionSkills: [],
    formError: null,
    attachStatus: null,
  };
  try {
    window.localStorage.setItem(activeKey(userId), state.conversationId);
  } catch {
    /* ignore */
  }
  emit();
}

export function loadAssistantLiveConversation(
  userId: string,
  conversationId: string,
  turns: LiveChatTurn[],
): void {
  if (inflight) return;
  state = {
    userId,
    conversationId,
    turns,
    busy: false,
    sessionSkills: state?.userId === userId ? state.sessionSkills : [],
    formError: null,
    attachStatus: null,
  };
  try {
    window.localStorage.setItem(activeKey(userId), conversationId);
  } catch {
    /* ignore */
  }
  emit();
}

export type AssistantAskPayload = {
  question: string;
  attachmentMeta?: AssistantHistoryAttachmentMeta & { kind?: "pdf" | "image" | "docx" };
  attachmentBase64?: string;
  applyJobId?: string;
  confirmApply?: boolean;
  ask: (args: { data: Record<string, unknown> }) => Promise<AskJobAssistantResult>;
  retryTurnId?: string;
};

/** Client ceiling — if the server fn never resolves (Vercel hang), clear Thinking… */
export const ASSISTANT_CLIENT_TIMEOUT_MS = 35_000 as const;

function withClientAskTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Assistant request timed out"));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Run an assistant ask against the live store. Safe if the React tree unmounts mid-request.
 */
export function runAssistantLiveAsk(userId: string, payload: AssistantAskPayload): Promise<void> {
  const live = ensureAssistantLiveState(userId);
  if (live.busy && !payload.retryTurnId) return inflight ?? Promise.resolve();

  const trimmed = payload.question.trim();
  if (trimmed.length < 3) return Promise.resolve();

  const turnId = payload.retryTurnId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const attachmentMeta = payload.attachmentMeta ?? null;

  const prevTurns = live.turns;
  let nextTurns: LiveChatTurn[];
  if (payload.retryTurnId) {
    nextTurns = prevTurns.map((t) =>
      t.id === payload.retryTurnId
        ? { ...t, result: null, pending: true, attachment: attachmentMeta }
        : t,
    );
  } else {
    nextTurns = [
      ...prevTurns,
      {
        id: turnId,
        question: trimmed,
        result: null,
        pending: true,
        attachment: attachmentMeta,
      },
    ];
  }

  state = {
    ...live,
    turns: nextTurns,
    busy: true,
    formError: null,
    attachStatus: payload.attachmentBase64 ? "Reading attachment…" : live.attachStatus,
  };
  emit();

  const conversationId = state.conversationId;
  const sessionSkills = state.sessionSkills;

  const lastJobs = [...prevTurns]
    .reverse()
    .find((t) => t.result?.ok && t.result.liveCitations.length > 0)?.result;
  const recentJobs =
    lastJobs && lastJobs.ok
      ? lastJobs.liveCitations.slice(0, 8).map((j) => ({
          id: j.id,
          title: j.title,
          location: j.location,
          description: j.description,
          job_type: j.job_type,
          company_name: j.company_name,
        }))
      : undefined;

  // Keep prior-turn context short — long context + Gemini 3.8 was timing out on live follow-ups.
  const conversationContext = prevTurns
    .filter((t) => t.result && !t.pending)
    .slice(-1)
    .map((t) => {
      const answer =
        t.result && t.result.ok
          ? t.result.answer.slice(0, 160)
          : t.result && !t.result.ok
            ? t.result.message.slice(0, 100)
            : "";
      return `User: ${t.question.slice(0, 120)}\nAssistant: ${answer}`;
    })
    .join("\n\n")
    .slice(0, 400);

  inflight = (async () => {
    try {
      const result = await withClientAskTimeout(
        payload.ask({
          data: {
            question: trimmed,
            ...(attachmentMeta
              ? {
                  attachmentMeta: {
                    name: attachmentMeta.name,
                    mime: attachmentMeta.mime,
                    sizeBytes: attachmentMeta.sizeBytes,
                    kind: attachmentMeta.kind,
                  },
                }
              : {}),
            ...(payload.attachmentBase64 ? { attachmentBase64: payload.attachmentBase64 } : {}),
            ...(sessionSkills.length ? { sessionSkills } : {}),
            ...(recentJobs?.length ? { recentJobs } : {}),
            ...(conversationContext ? { conversationContext } : {}),
            ...(conversationId ? { conversationId } : {}),
            ...(payload.applyJobId ? { applyJobId: payload.applyJobId } : {}),
            ...(payload.confirmApply ? { confirmApply: true } : {}),
          },
        }),
        ASSISTANT_CLIENT_TIMEOUT_MS,
      );

      if (!state || state.userId !== userId) return;

      const updatedTurns = state.turns.map((t) =>
        t.id === turnId ? { ...t, result, pending: false } : t,
      );
      let attachStatus = state.attachStatus;
      let nextSkills = state.sessionSkills;
      let formError: string | null = null;

      if (result.ok) {
        if (result.sessionSkills?.length) nextSkills = result.sessionSkills;
        if (result.resumeProcess?.status === "read") attachStatus = "Resume processed";
        else if (result.resumeProcess?.status === "processed")
          attachStatus = "Attachment processed";
        else if (
          result.resumeProcess?.status === "failed" ||
          result.resumeProcess?.status === "unsupported"
        ) {
          attachStatus = result.resumeProcess.message;
        } else {
          attachStatus = null;
        }
      } else {
        formError = result.message;
        if (
          result.resumeProcess?.status === "failed" ||
          result.resumeProcess?.status === "unsupported"
        ) {
          attachStatus = result.resumeProcess.message;
        } else {
          // Clear sticky "Reading attachment…" after Gemini/rate-limit failures.
          attachStatus = null;
        }
      }

      state = {
        ...state,
        turns: updatedTurns,
        busy: false,
        sessionSkills: nextSkills,
        formError,
        attachStatus,
      };
      persistCompleted(userId, conversationId, updatedTurns, trimmed);
      emit();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      const message = /Unauthorized|auth/i.test(raw)
        ? "Sign in as a job seeker to use the assistant."
        : /Missing Supabase environment variable/i.test(raw)
          ? "Assistant server is missing Supabase config. Add SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY) and restart the app."
          : /timed out/i.test(raw)
            ? "The assistant took too long. Please try again."
            : "Something went wrong talking to the assistant. Try again.";
      if (!state || state.userId !== userId) return;
      const updatedTurns = state.turns.map((t) =>
        t.id === turnId
          ? {
              ...t,
              pending: false,
              result: { ok: false as const, code: "unknown" as const, message },
            }
          : t,
      );
      state = {
        ...state,
        turns: updatedTurns,
        busy: false,
        formError: message,
      };
      persistCompleted(userId, conversationId, updatedTurns, trimmed);
      emit();
    } finally {
      inflight = null;
      if (state && state.userId === userId && state.busy) {
        state = { ...state, busy: false };
        emit();
      }
    }
  })();

  return inflight;
}

export function getAssistantInflight(): Promise<void> | null {
  return inflight;
}
