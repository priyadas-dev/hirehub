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
  SendHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { AssistantMarkdown } from "@/components/assistant/AssistantMarkdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askJobAssistant } from "@/lib/ai/ask-job-assistant";
import {
  ASSISTANT_ATTACHMENT_ACCEPT,
  fileToBase64,
  validateAssistantAttachment,
} from "@/lib/ai/assistant-attachments";
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
  const [attachment, setAttachment] = useState<{
    file: File;
    meta: AssistantHistoryAttachmentMeta & { kind: "pdf" | "image" | "docx" };
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const busy = live?.busy ?? false;
  const turns = useMemo(() => live?.turns ?? [], [live?.turns]);
  const conversationId = live?.conversationId ?? "";
  const formError = live?.formError ?? null;
  const attachStatus = live?.attachStatus ?? null;

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

  async function submit(nextQuestion: string, options?: { retryTurnId?: string }) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || !userId || (busy && !options?.retryTurnId)) return;

    setQuestion("");
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
      retryTurnId: options?.retryTurnId,
      ask: async ({ data }) => ask({ data: data as AskJobAssistantInput }),
    });

    setAttachment(null);
    inputRef.current?.focus();
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
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-4 lg:flex-row">
      <aside className="surface-card flex w-full shrink-0 flex-col overflow-hidden lg:w-64">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            History
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={startNewConversation}
            disabled={busy}
          >
            <Plus /> New
          </Button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              Conversations stay on this device/browser for your account. No secrets are stored.
            </p>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group rounded-xl border px-2 py-2 transition-colors",
                  c.id === conversationId
                    ? "border-signal/40 bg-signal/10"
                    : "border-transparent hover:bg-muted/50",
                )}
              >
                <button
                  type="button"
                  className="w-full truncate text-left text-sm font-medium text-foreground"
                  onClick={() => openConversation(c)}
                  disabled={busy}
                >
                  {c.title}
                </button>
                <div className="mt-1 flex items-center gap-1 opacity-80 group-hover:opacity-100">
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                    aria-label="Rename conversation"
                    onClick={() => handleRename(c)}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive"
                    aria-label="Delete conversation"
                    onClick={() => handleDelete(c)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-signal">
              <Sparkles className="size-4" />
              <p className="text-xs font-medium uppercase tracking-[0.14em]">Job Seeker</p>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              AI Job Assistant
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Ask anything — career advice, interview prep, concepts, or approved HireHub jobs.
              Answers keep going if you navigate away and come back.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/seeker/jobs">
              <Briefcase /> Browse jobs
            </Link>
          </Button>
        </div>

        <div className="surface-card flex min-h-[28rem] flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
            {turns.length === 0 ? (
              <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-4 text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-signal/10 text-signal">
                  <Bot className="size-6" />
                </div>
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Ask your first career question</p>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Matching approved jobs appear as cards. Attach a PDF, DOCX, or image when
                    useful, or type skills and filters in your question.
                  </p>
                </div>
                <div className="flex max-w-xl flex-wrap justify-center gap-2">
                  {STARTERS.map((starter) => (
                    <Button
                      key={starter}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void submit(starter)}
                    >
                      {starter}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              turns.map((turn) => (
                <div key={turn.id} className="space-y-3">
                  <div className="flex justify-end">
                    <div className="max-w-[85%] space-y-2 rounded-2xl rounded-br-md bg-signal/15 px-4 py-3 text-sm text-foreground">
                      <p>{turn.question}</p>
                      {turn.attachment && (
                        <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Paperclip className="size-3" />
                          {turn.attachment.name}
                        </p>
                      )}
                    </div>
                  </div>
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
                          onRetry={() => void submit(turn.question, { retryTurnId: turn.id })}
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t bg-background/80 px-4 py-3 sm:px-6">
            {formError && (
              <p className="mb-2 text-sm text-destructive" role="alert">
                {formError}
              </p>
            )}
            {(attachment || attachStatus) && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
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
            <form
              className="flex items-center gap-2"
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
                className="size-11 shrink-0 rounded-full"
                aria-label="Attach file"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip />
              </Button>
              <Input
                ref={inputRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask anything — jobs, skills, concepts…"
                disabled={busy}
                maxLength={1500}
                className="h-11 flex-1 rounded-full border-border/80 bg-background px-4"
                aria-label="Follow-up question"
              />
              <Button
                type="submit"
                variant="signal"
                size="icon"
                className="size-11 shrink-0 rounded-full"
                disabled={busy || question.trim().length < 3}
                aria-label="Send question"
              >
                {busy ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
              </Button>
            </form>
            <p className="mt-2 text-[11px] text-muted-foreground">
              PDF, DOCX, and images are processed on the server. File contents are not saved in
              history. History is local to this browser only.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({
  result,
  onRetry,
}: {
  result: AskJobAssistantResult;
  onRetry: () => void;
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
