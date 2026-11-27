import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Bot,
  Briefcase,
  Building2,
  Loader2,
  MapPin,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SendHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { AssistantMarkdown } from "@/components/assistant/AssistantMarkdown";
import {
  ApplicationStatusOutcomeList,
  SaveJobOutcomeChip,
} from "@/components/assistant/AssistantToolOutcomes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askJobAssistant } from "@/lib/ai/ask-job-assistant";
import {
  ASSISTANT_ATTACHMENT_ACCEPT,
  fileToBase64,
  validateAssistantAttachment,
} from "@/lib/ai/assistant-attachments";
import { formatSeekerChatUserQuestion } from "@/lib/ai/assistant-chat-display";
import {
  deleteConversation,
  readAssistantHistory,
  renameConversation,
  writeAssistantHistory,
  type AssistantConversation,
  type AssistantHistoryAttachmentMeta,
} from "@/lib/ai/assistant-history";
import {
  ensureAssistantLiveState,
  getAssistantLiveState,
  loadAssistantLiveConversation,
  patchAssistantLive,
  resetAssistantLiveConversation,
  runAssistantLiveAsk,
  subscribeAssistantLive,
  type LiveChatTurn,
} from "@/lib/ai/assistant-live-store";
import type { AskJobAssistantInput } from "@/lib/ai/job-assistant";
import {
  ASSISTANT_SETUP_HINT,
  type AskJobAssistantResult,
  type AssistantLiveCitation,
} from "@/lib/ai/job-assistant";
import { useAuth } from "@/lib/auth";
import { JOB_TYPE_LABEL, type JobType } from "@/lib/hirehub";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/seeker/assistant")({
  head: () => ({
    meta: [
      { title: "AI Job Assistant — HireHub" },
      {
        name: "description",
        content: "Ask HireHub about skills, career direction, and approved job opportunities.",
      },
    ],
  }),
  component: SeekerAssistantPage,
});

const STARTERS = [
  "What is React?",
  "How should I prepare for an interview?",
  "I know React, JavaScript and SQL. Find suitable jobs",
  "Show me remote jobs",
] as const;

function formatHistoryWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return "Yesterday";
  }
  const weekAgo = now.getTime() - 6 * 24 * 60 * 60 * 1000;
  if (t >= weekAgo) {
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function useAssistantLive(userId: string) {
  return useSyncExternalStore(
    subscribeAssistantLive,
    () => (userId ? getAssistantLiveState() : null),
    () => null,
  );
}

function SeekerAssistantPage() {
  const ask = useServerFn(askJobAssistant);
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const live = useAssistantLive(userId);

  const [question, setQuestion] = useState("");
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [attachment, setAttachment] = useState<{
    file: File;
    meta: AssistantHistoryAttachmentMeta & { kind: "pdf" | "image" | "docx" };
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const editInputRef = useRef<HTMLTextAreaElement | null>(null);

  const busy = live?.busy ?? false;
  const turns = useMemo(() => live?.turns ?? [], [live?.turns]);
  const conversationId = live?.conversationId ?? "";
  const formError = live?.formError ?? null;
  const attachStatus = live?.attachStatus ?? null;

  const filteredHistory = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, historyQuery]);

  /** Job id → title for hiding UUIDs in chat bubbles. */
  const jobTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const turn of turns) {
      const r = turn.result;
      if (!r || !r.ok) continue;
      if (r.pendingApply?.jobId && r.pendingApply.title) {
        map.set(r.pendingApply.jobId, r.pendingApply.title);
      }
      if (r.saveOutcome?.jobId && r.saveOutcome.title) {
        map.set(r.saveOutcome.jobId, r.saveOutcome.title);
      }
      for (const job of r.liveCitations ?? []) {
        if (job.id && job.title) map.set(job.id, job.title);
      }
    }
    return map;
  }, [turns]);

  useEffect(() => {
    if (!userId) return;
    ensureAssistantLiveState(userId);
    setConversations(readAssistantHistory(userId).conversations);
  }, [userId]);

  // Keep the History sidebar in sync (ChatGPT-style thread list) whenever live store updates.
  useEffect(() => {
    if (!userId) return;
    const refresh = () => {
      setConversations(readAssistantHistory(userId).conversations);
    };
    refresh();
    const unsub = subscribeAssistantLive(refresh);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
    };
  }, [userId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  async function submit(
    nextQuestion: string,
    options?: {
      retryTurnId?: string;
      editTurnId?: string;
      applyJobId?: string;
      confirmApply?: boolean;
    },
  ) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || !userId || (busy && !options?.retryTurnId && !options?.editTurnId)) return;

    setQuestion("");
    setEditingTurnId(null);
    setEditDraft("");
    let attachmentBase64: string | undefined;
    const attachmentMeta = attachment?.meta ?? undefined;
    if (attachment?.file) {
      patchAssistantLive({ attachStatus: "Reading attachment…" });
      attachmentBase64 = await fileToBase64(attachment.file);
    }

    await runAssistantLiveAsk(userId, {
      question: trimmed,
      attachmentMeta,
      attachmentBase64,
      applyJobId: options?.applyJobId,
      confirmApply: options?.confirmApply,
      retryTurnId: options?.retryTurnId,
      editTurnId: options?.editTurnId,
      ask: async ({ data }) => ask({ data: data as AskJobAssistantInput }),
    });

    setAttachment(null);
    inputRef.current?.focus();
  }

  function beginEditTurn(turn: LiveChatTurn) {
    if (busy) return;
    setEditingTurnId(turn.id);
    setEditDraft(formatSeekerChatUserQuestion(turn.question, jobTitleById));
    queueMicrotask(() => editInputRef.current?.focus());
  }

  function cancelEditTurn() {
    setEditingTurnId(null);
    setEditDraft("");
  }

  function startNewConversation() {
    if (!userId || busy) return;
    resetAssistantLiveConversation(userId);
    setQuestion("");
    setAttachment(null);
    setConversations(readAssistantHistory(userId).conversations);
    inputRef.current?.focus();
  }

  function openConversation(conversation: AssistantConversation) {
    if (!userId || busy) return;
    const nextTurns: LiveChatTurn[] = conversation.messages.map((m) => ({
      id: m.id,
      question: m.question,
      result: m.result as AskJobAssistantResult,
      pending: false,
      attachment: m.attachment ?? null,
    }));
    loadAssistantLiveConversation(userId, conversation.id, nextTurns);
  }

  function handleRename(conversation: AssistantConversation) {
    if (!userId) return;
    const next = window.prompt("Rename conversation", conversation.title);
    if (next == null) return;
    const store = renameConversation(readAssistantHistory(userId), conversation.id, next);
    writeAssistantHistory(userId, store);
    setConversations(store.conversations);
  }

  function handleDelete(conversation: AssistantConversation) {
    if (!userId) return;
    if (!window.confirm("Delete this conversation from this browser?")) return;
    const store = deleteConversation(readAssistantHistory(userId), conversation.id);
    writeAssistantHistory(userId, store);
    setConversations(store.conversations);
    if (conversation.id === conversationId) startNewConversation();
  }

  function onPickFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    const validated = validateAssistantAttachment(file);
    if (!validated.ok) {
      patchAssistantLive({ formError: validated.error, attachStatus: null });
      return;
    }
    setAttachment({
      file,
      meta: {
        name: validated.meta.name,
        mime: validated.meta.mime,
        sizeBytes: validated.meta.sizeBytes,
        kind: validated.meta.kind,
      },
    });
    patchAssistantLive({
      formError: null,
      attachStatus:
        validated.meta.kind === "pdf"
          ? "Resume attached"
          : validated.meta.kind === "docx"
            ? "Document attached"
            : "Image attached",
    });
  }

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-4rem)] flex-col overflow-hidden bg-[#f4f7f6] sm:-mx-6 sm:-my-8 lg:-mx-10 lg:-my-12 lg:flex-row">
      <aside className="flex max-h-[40vh] w-full shrink-0 flex-col border-b border-border bg-white lg:max-h-none lg:h-full lg:w-72 lg:border-b-0 lg:border-r lg:border-border">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3.5 py-3">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            History
          </h2>
          <button
            type="button"
            onClick={startNewConversation}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-full bg-signal/12 px-2.5 py-1 text-[11px] font-semibold text-signal transition-[background-color,transform] duration-150 hover:bg-signal/20 active:scale-[0.98] disabled:opacity-50"
            title="Start a new chat"
          >
            <Plus className="size-3.5" aria-hidden />
            New
          </button>
        </div>
        <div className="shrink-0 border-b border-border/60 px-2.5 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
              placeholder="Search conversations…"
              aria-label="Search conversations"
              className="h-8 rounded-lg border-border/80 bg-muted/40 pl-8 text-xs"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2" role="list">
          {conversations.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs leading-relaxed text-muted-foreground">
              Past chats stay on this device. No secrets are stored.
            </p>
          ) : filteredHistory.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">No matches.</p>
          ) : (
            filteredHistory.map((c) => {
              const active = c.id === conversationId;
              return (
                <div
                  key={c.id}
                  role="listitem"
                  className={cn(
                    "group relative flex items-start gap-0.5 rounded-xl border px-2 py-2.5 transition-[background-color,border-color,box-shadow] duration-200 ease-out",
                    active
                      ? "border-border bg-signal/10 shadow-xs"
                      : "border-transparent hover:border-border/70 hover:bg-muted/40",
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded-lg px-1 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-signal/30 disabled:opacity-50"
                    aria-current={active ? "true" : undefined}
                    onClick={() => openConversation(c)}
                    disabled={busy}
                  >
                    <p
                      className={cn(
                        "line-clamp-2 text-[12px] leading-snug tracking-tight",
                        active ? "font-semibold text-foreground" : "font-medium text-foreground/85",
                      )}
                      title={c.title}
                    >
                      {c.title}
                    </p>
                    <p
                      className={cn(
                        "mt-1 text-[10px] tabular-nums",
                        active ? "text-signal/80" : "text-muted-foreground",
                      )}
                    >
                      {formatHistoryWhen(c.updatedAt)}
                    </p>
                  </button>
                  <div className="mt-0.5 flex shrink-0 flex-col gap-0.5 opacity-90 group-hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="Rename conversation"
                      onClick={() => handleRename(c)}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Delete conversation"
                      onClick={() => handleDelete(c)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#f8faf9]">
        <header className="shrink-0 border-b border-border/80 bg-white px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-signal/25 bg-signal-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-signal">
                  <Sparkles className="size-3.5" aria-hidden />
                  Job Seeker
                </span>
                <span className="text-xs text-muted-foreground">Career Copilot</span>
              </div>
              <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                AI Job Assistant
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Ask anything — career advice, interview prep, concepts, or approved HireHub jobs.
                Answers keep going if you navigate away and come back.
              </p>
            </div>
            <Button variant="outline" size="sm" asChild className="self-start md:self-end">
              <Link to="/seeker/jobs">
                <Briefcase /> Browse jobs
              </Link>
            </Button>
          </div>
        </header>

        <section className="flex min-h-0 flex-1 animate-fade-up flex-col overflow-hidden bg-white">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
            {turns.length === 0 ? (
              <div className="flex h-full min-h-[18rem] flex-col items-center justify-center text-center">
                <div className="mb-5 flex size-14 items-center justify-center rounded-2xl border border-signal/25 bg-signal-soft text-signal shadow-sm">
                  <Bot className="size-7" aria-hidden />
                </div>
                <h3 className="text-lg font-bold tracking-tight text-foreground">
                  Ask your first career question
                </h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Matching approved jobs appear as cards. Attach a PDF, DOCX, or image when useful,
                  or type skills and filters in your question.
                </p>
                <div className="mt-7 flex max-w-2xl flex-wrap items-center justify-center gap-2">
                  {STARTERS.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      disabled={busy}
                      onClick={() => void submit(starter)}
                      className="rounded-xl border border-border bg-[#f8faf9] px-3.5 py-2.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:border-signal/40 hover:bg-signal-soft hover:text-signal disabled:opacity-50"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto w-full max-w-3xl space-y-5">
                {turns.map((turn, turnIndex) => {
                  const editIdx = editingTurnId
                    ? turns.findIndex((t) => t.id === editingTurnId)
                    : -1;
                  if (editIdx >= 0 && turnIndex > editIdx) return null;

                  return (
                    <div key={turn.id} className="space-y-3">
                      <div className="flex justify-end">
                        <div className="group max-w-[85%] space-y-2">
                          {editingTurnId === turn.id ? (
                            <div className="space-y-2 rounded-2xl rounded-br-md border border-signal/30 bg-background px-3 py-2 shadow-sm">
                              <textarea
                                ref={editInputRef}
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                rows={3}
                                disabled={busy}
                                className="w-full resize-y rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-signal/40"
                                aria-label="Edit message"
                              />
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={busy}
                                  onClick={cancelEditTurn}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="signal"
                                  disabled={busy || editDraft.trim().length < 3}
                                  onClick={() => void submit(editDraft, { editTurnId: turn.id })}
                                >
                                  Save & send
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="relative space-y-2 rounded-2xl rounded-br-md bg-signal/15 px-4 py-3 text-sm text-foreground">
                              <p>{formatSeekerChatUserQuestion(turn.question, jobTitleById)}</p>
                              {turn.attachment && (
                                <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <Paperclip className="size-3" />
                                  {turn.attachment.name}
                                </p>
                              )}
                              <button
                                type="button"
                                className="absolute -left-9 top-1 inline-flex size-7 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-100 shadow-sm transition hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100"
                                aria-label="Edit message"
                                title="Edit message"
                                disabled={busy || turn.pending}
                                onClick={() => beginEditTurn(turn)}
                              >
                                <Pencil className="size-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      {editingTurnId !== turn.id && (
                        <div className="flex items-start gap-3">
                          <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-signal/10 text-signal">
                            <Bot className="size-4" />
                          </div>
                          <div className="min-w-0 flex-1 space-y-3">
                            {turn.pending || !turn.result ? (
                              <div
                                className="rounded-2xl rounded-tl-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
                                aria-busy="true"
                              >
                                <span className="inline-flex items-center gap-2">
                                  <Loader2 className="size-4 animate-spin" /> Thinking…
                                </span>
                              </div>
                            ) : (
                              <AssistantMessage
                                result={turn.result}
                                busy={busy}
                                onRetry={() => void submit(turn.question, { retryTurnId: turn.id })}
                                onConfirmApply={(jobId) => {
                                  // Show job title in chat — never the UUID. Identity travels via
                                  // conversationContext in the live store; applyJobId is the real id.
                                  const title =
                                    (turn.result?.ok && turn.result.pendingApply?.title) ||
                                    jobTitleById.get(jobId) ||
                                    "this job";
                                  void runAssistantLiveAsk(userId, {
                                    question: `Please confirm apply to ${title}`.slice(0, 200),
                                    applyJobId: jobId,
                                    confirmApply: true,
                                    ask: async ({ data }) =>
                                      ask({ data: data as AskJobAssistantInput }),
                                  });
                                }}
                              />
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="shrink-0 border-t border-border/80 bg-[#f8faf9] px-4 py-3 sm:px-6">
            {formError && (
              <p className="mb-2 text-center text-sm text-destructive" role="alert">
                {formError}
              </p>
            )}
            {(attachment || attachStatus) && (
              <div className="mx-auto mb-2 flex max-w-3xl flex-wrap items-center gap-2">
                {attachment && (
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-xs text-foreground">
                    <Paperclip className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{attachment.meta.name}</span>
                    <button
                      type="button"
                      className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                      aria-label="Remove attachment"
                      onClick={() => {
                        setAttachment(null);
                        patchAssistantLive({ attachStatus: null });
                      }}
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                )}
                {!attachment && attachStatus && (
                  <span className="text-xs text-muted-foreground">{attachStatus}</span>
                )}
              </div>
            )}
            {turns.length > 0 ? (
              <div className="mx-auto mb-2.5 flex max-w-3xl gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => void submit(s)}
                    className="shrink-0 rounded-full border border-border bg-white px-3 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:border-signal/40 hover:bg-signal-soft disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
            <form
              className="mx-auto flex max-w-3xl items-center gap-2 rounded-2xl border border-border bg-white p-1.5 shadow-xs transition-shadow focus-within:border-signal focus-within:ring-2 focus-within:ring-signal/15"
              onSubmit={(e) => {
                e.preventDefault();
                void submit(question);
              }}
            >
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept={ASSISTANT_ATTACHMENT_ACCEPT}
                onChange={(e) => {
                  onPickFile(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-10 shrink-0 rounded-xl border-0 bg-transparent shadow-none hover:bg-muted"
                aria-label="Attach file"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip className="size-4" />
              </Button>
              <Input
                ref={inputRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask anything — jobs, skills, concepts…"
                disabled={busy}
                maxLength={1500}
                className="h-10 flex-1 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
                aria-label="Follow-up question"
              />
              <Button
                type="submit"
                variant="signal"
                size="icon"
                className="size-10 shrink-0 rounded-xl"
                disabled={busy || question.trim().length < 3}
                aria-label="Send question"
              >
                {busy ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <SendHorizontal className="size-4" />
                )}
              </Button>
            </form>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              PDF, DOCX, and images are processed on the server. File contents are not saved in
              chat threads. Thread list is local to this browser; learned preferences stay in
              server memory until you use Forget me.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

function AssistantMessage({
  result,
  onRetry,
  onConfirmApply,
  busy,
}: {
  result: AskJobAssistantResult;
  onRetry: () => void;
  onConfirmApply?: (jobId: string) => void;
  busy?: boolean;
}) {
  if (!result.ok) {
    return (
      <div className="space-y-3 rounded-2xl rounded-tl-md border border-destructive/20 bg-destructive/5 px-4 py-3">
        <p className="text-sm font-semibold text-destructive">
          {result.code === "gemini_unavailable" ? "Assistant unavailable" : "Could not answer"}
        </p>
        <p className="text-sm text-muted-foreground">{result.message}</p>
        {result.code === "gemini_unavailable" && result.setupHint && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {result.setupHint ?? ASSISTANT_SETUP_HINT}
          </p>
        )}
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl rounded-tl-md border bg-muted/30 px-4 py-3">
        <AssistantMarkdown text={result.answer} />
      </div>

      {result.pendingApply && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-signal/30 bg-signal/5 px-4 py-3">
          <p className="text-sm text-foreground">
            Confirm apply to <span className="font-medium">{result.pendingApply.title}</span>?
          </p>
          <Button
            type="button"
            size="sm"
            variant="signal"
            disabled={busy}
            onClick={() => onConfirmApply?.(result.pendingApply!.jobId)}
          >
            Confirm apply
          </Button>
        </div>
      )}

      {result.applyOutcome && (
        <div className="pt-1">
          <Button variant="outline" size="sm" asChild>
            <Link
              to="/seeker/applications/$applicationId"
              params={{ applicationId: result.applyOutcome.applicationId }}
            >
              View application
            </Link>
          </Button>
        </div>
      )}

      {result.saveOutcome && <SaveJobOutcomeChip outcome={result.saveOutcome} />}

      {result.applicationStatuses && (
        <ApplicationStatusOutcomeList applications={result.applicationStatuses} />
      )}

      {result.liveCitations.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Matching approved jobs ({result.liveCitations.length})
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {result.liveCitations.map((job) => (
              <LiveJobCard key={job.id} job={job} />
            ))}
          </div>
        </div>
      )}
      {Boolean(result.soughtLiveJobs) && result.liveCitations.length === 0 && (
        <div className="pt-1">
          <Button variant="outline" size="sm" asChild>
            <Link to="/seeker/jobs">
              <Briefcase /> Browse jobs
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function LiveJobCard({ job }: { job: AssistantLiveCitation }) {
  const description = (job.description ?? "").replace(/\s+/g, " ").trim();
  const short =
    description.length > 160 ? `${description.slice(0, 157).trimEnd()}…` : description || null;
  const typeLabel =
    job.job_type && job.job_type in JOB_TYPE_LABEL ? JOB_TYPE_LABEL[job.job_type as JobType] : null;

  return (
    <article className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm">
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-snug text-foreground">{job.title}</h3>
          <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
            Approved
          </span>
        </div>
        {job.company_name && (
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Building2 className="size-3.5" />
            {job.company_name}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        {job.location && (
          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5">
            <MapPin className="size-3" />
            {job.location}
          </span>
        )}
        {typeLabel && <span className="rounded-full border px-2 py-0.5">{typeLabel}</span>}
      </div>
      {short && <p className="text-xs leading-relaxed text-muted-foreground">{short}</p>}
      {job.matchReason && <p className="text-xs font-medium text-signal">{job.matchReason}</p>}
      {job.matchedSkills && job.matchedSkills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {job.matchedSkills.map((skill) => (
            <span
              key={skill}
              className="rounded-full bg-signal/10 px-2 py-0.5 text-[10px] font-medium text-signal"
            >
              {skill}
            </span>
          ))}
        </div>
      )}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Button asChild size="sm" variant="signal" className={cn("flex-1")}>
          <Link to="/seeker/jobs/$jobId" params={{ jobId: job.id }}>
            View job
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline" className="flex-1">
          <Link to="/seeker/jobs/$jobId" params={{ jobId: job.id }}>
            Apply now
          </Link>
        </Button>
      </div>
    </article>
  );
}
