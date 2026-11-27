import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bot,
  Briefcase,
  Copy,
  Loader2,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SendHorizontal,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { RecruiterAgentLoading } from "@/components/recruiter/RecruiterAgentFeedback";
import type { ApplicationStatus } from "@/components/status/status";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { askRecruiterAgent } from "@/lib/ai/ask-recruiter-agent";
import {
  createRecruiterConversationId,
  deleteRecruiterConversation,
  readRecruiterAgentHistory,
  renameRecruiterConversation,
  titleFromRecruiterTurn,
  upsertRecruiterConversation,
  writeRecruiterAgentHistory,
  type RecruiterAgentConversation,
} from "@/lib/ai/recruiter-agent-history";
import { ResumeOpenLink } from "@/components/applications/ResumeOpenLink";
import { RECRUITER_RESUME_ACCESS_DENIED_MESSAGE } from "@/lib/ai/agents/recruiter-applicant-access";
import {
  RECRUITER_SHORTLIST_PROCESS_HELP,
  applicantDisplayName,
  detectRecruiterChatIntent,
  applyApplicantStatusFilter,
  extractApplicantNameHint,
  extractApplicantNameHints,
  extractApplicantOrdinalRef,
  extractApplicantStatusFilter,
  extractJobTitleHint,
  extractResumeOpenNameHint,
  extractTopNApplicants,
  formatOwnedJobsReply as formatOwnedJobsChatReply,
  formatRankedApplicantsReply,
  htmlToEditablePlain,
  isListJobsWithApplicantsQuestion,
  isOfferDraftishQuestion,
  isShortlistableApplicationStatus,
  matchApplicantsByNameHint,
  matchOwnedJobByTitle,
  normalizeRecruiterChatTurn,
  parseOutreachAgentResult,
  parseShortlistAgentResult,
  parseSupervisedAgentMessage,
  preferShortlistableApplicants,
  rankApplicantsByProfileAndResume,
  inferOwnedJobIdFromContext,
  rankOwnedJobsByQuery,
  resolveApplicantChoiceFromRef,
  suggestJobsWithApplicants,
  type RecruiterChatTurn,
} from "@/lib/ai/recruiter-agent-ui";
import { useAuth } from "@/lib/auth";
import { resolveDisplayUrl } from "@/lib/hirehub-storage";
import { supabase } from "@/components/dashboard/parts";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/recruiter/agent")({
  head: () => ({
    meta: [
      { title: "AI Recruiter Agent — HireHub" },
      {
        name: "description",
        content: "Chat to shortlist applicants and draft outreach via the HireHub Supervisor.",
      },
    ],
  }),
  component: RecruiterAgentPage,
});

type OwnedJob = {
  id: string;
  title: string;
  status: string;
  description: string | null;
  created_at?: string;
  applicantCount: number;
};

type ApplicantRow = {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  seeker_id: string;
  job_id: string;
  cover_note: string | null;
  resume_url: string | null;
  resume_storage_path: string | null;
  resume_file_name: string | null;
  portfolio_url: string | null;
  jobs: { id: string; title: string; description: string | null; recruiter_id: string } | null;
  profiles: { full_name: string | null; email: string | null } | null;
};

/** Recruiter-visible signals only (no private skills browse). Resume = metadata + cover note. */
const APP_SELECT =
  "id,status,created_at,seeker_id,job_id,cover_note,resume_url,resume_storage_path,resume_file_name,portfolio_url,jobs!inner(id,title,description,recruiter_id),profiles(full_name,email)";

const STARTERS = [
  "List my jobs with applicants",
  "Show applicants for this job",
  "Propose shortlist for the selected applicant",
  "Draft outreach for this job",
] as const;

const CROSS_JOB_APP_LIMIT = 80;
const AGENT_TOAST_MS = 2500;

function newTurnId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function personInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (a + b).toUpperCase() || "?";
}

/** Display-only: strip technical asides from chat bubbles (authz logic unchanged). */
function softenAssistantDisplayText(raw: string): string {
  return raw
    .replace(/\s*\(JWT\s+recruiter_id\)/gi, "")
    .replace(/\bJWT\s+recruiter_id\b/gi, "ownership")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

type AssistantTextBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: Array<{ title: string; meta?: string }> };

function parseAssistantTextBlocks(raw: string): AssistantTextBlock[] {
  const cleaned = softenAssistantDisplayText(raw);
  if (!cleaned) return [];
  const blocks: AssistantTextBlock[] = [];
  const chunks = cleaned.split(/\n{2,}/);

  for (const chunk of chunks) {
    const lines = chunk
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    const numbered = lines.filter((l) => /^\d+\.\s+/.test(l));
    const mostlyList = numbered.length >= 2 && numbered.length >= Math.ceil(lines.length * 0.5);

    if (mostlyList) {
      const prose = lines.filter((l) => !/^\d+\.\s+/.test(l));
      for (const p of prose) {
        blocks.push({ kind: "paragraph", text: p });
      }
      blocks.push({
        kind: "list",
        items: numbered.map((line) => {
          const body = line.replace(/^\d+\.\s+/, "");
          const parts = body.split(/\s+[—–-]\s+/);
          const title = (parts[0] ?? body).trim();
          const meta = parts.slice(1).join(" — ").trim() || undefined;
          return meta ? { title, meta } : { title };
        }),
      });
      continue;
    }

    blocks.push({ kind: "paragraph", text: lines.join(" ") });
  }

  return blocks;
}

function listTitleMatchesJob(itemTitle: string, jobTitle: string | null | undefined): boolean {
  if (!jobTitle) return false;
  const cleaned = itemTitle.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();
  return cleaned === jobTitle.trim().toLowerCase() || itemTitle.toLowerCase().includes(jobTitle.toLowerCase());
}

/** Compact relative time for History cards (local browser clock). */
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

function AssistantMessageBody({
  text,
  onPickListItem,
  selectedJobTitle,
}: {
  text: string;
  onPickListItem?: (title: string) => void;
  selectedJobTitle?: string | null;
}) {
  const blocks = parseAssistantTextBlocks(text);
  if (blocks.length === 0) {
    return <p className="select-text text-sm leading-relaxed text-foreground">{text}</p>;
  }
  return (
    <div className="select-text space-y-3 text-sm leading-relaxed text-foreground">
      {blocks.map((block, i) =>
        block.kind === "paragraph" ? (
          <p key={`p-${i}`} className="text-[15px] leading-relaxed">
            {block.text}
          </p>
        ) : (
          <ul
            key={`l-${i}`}
            className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/80 bg-background"
          >
            {block.items.map((item, j) => {
              const selected = listTitleMatchesJob(item.title, selectedJobTitle);
              const row = (
                <>
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums",
                      selected ? "bg-signal text-signal-foreground" : "bg-signal/10 text-signal",
                    )}
                  >
                    {j + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-foreground">{item.title}</p>
                    {item.meta ? (
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{item.meta}</p>
                    ) : null}
                  </div>
                  {selected ? (
                    <span className="shrink-0 rounded-full bg-signal/15 px-2 py-0.5 text-[10px] font-semibold text-signal">
                      Selected
                    </span>
                  ) : onPickListItem ? (
                    <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
                      Select
                    </span>
                  ) : null}
                </>
              );
              return onPickListItem ? (
                <li key={`i-${i}-${j}`}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/30",
                      selected ? "bg-signal/10" : "hover:bg-signal/5",
                    )}
                    onClick={(e) => {
                      // Don't steal a text-selection copy gesture.
                      const sel = window.getSelection()?.toString();
                      if (sel && sel.length > 0) return;
                      e.preventDefault();
                      onPickListItem(item.title);
                    }}
                  >
                    {row}
                  </button>
                </li>
              ) : (
                <li key={`i-${i}-${j}`} className="flex items-center gap-3 px-3.5 py-3">
                  {row}
                </li>
              );
            })}
          </ul>
        ),
      )}
    </div>
  );
}

function appCountFromJoin(row: { applications?: { count: number }[] | null }): number {
  const apps = row.applications;
  if (!Array.isArray(apps) || !apps[0]) return 0;
  return typeof apps[0].count === "number" ? apps[0].count : 0;
}

function formatApplicantsReply(list: ApplicantRow[]): string {
  if (list.length === 0) {
    return "No applicants found for the current filter (owned jobs only).";
  }
  const lines = list
    .slice(0, 15)
    .map((a, i) => {
      const name = applicantDisplayName({
        full_name: a.profiles?.full_name,
        email: a.profiles?.email,
      });
      const title = a.jobs?.title ?? "Job";
      return `${i + 1}. ${name} — ${title} — ${a.status}`;
    })
    .join("\n");
  return `Applicants (owned jobs only):\n${lines}`;
}

function RecruiterAgentPage() {
  const { user } = useAuth();
  const id = user?.id;
  const qc = useQueryClient();
  const ask = useServerFn(askRecruiterAgent);

  const [jobId, setJobId] = useState("");
  const [selectedAppId, setSelectedAppId] = useState("");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<RecruiterChatTurn[]>([]);
  const [conversationId, setConversationId] = useState(() => createRecruiterConversationId());
  const [conversations, setConversations] = useState<RecruiterAgentConversation[]>([]);
  const [busy, setBusy] = useState(false);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [pendingShortlistAppId, setPendingShortlistAppId] = useState<string | null>(null);
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [chatSwitchKey, setChatSwitchKey] = useState(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const editInputRef = useRef<HTMLTextAreaElement | null>(null);
  const persistTitleRef = useRef<string>("New conversation");
  /** Keep in sync with conversationId so flush/open never write the wrong thread. */
  const activeConversationIdRef = useRef(conversationId);
  /** Skip one persist after History open so the list does not jump to top. */
  const skipNextPersistRef = useRef(false);

  const jobs = useQuery({
    queryKey: ["recruiter-jobs-lite", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,title,status,description,created_at,applications(count)")
        .eq("recruiter_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => {
        const r = row as {
          id: string;
          title: string;
          status: string;
          description: string | null;
          created_at?: string;
          applications?: { count: number }[] | null;
        };
        return {
          id: r.id,
          title: r.title,
          status: r.status,
          description: r.description,
          created_at: r.created_at,
          applicantCount: appCountFromJoin(r),
        } satisfies OwnedJob;
      });
    },
  });

  const appsForJob = useQuery({
    queryKey: ["recruiter-agent-applicants", id, jobId],
    enabled: !!id && !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select(APP_SELECT)
        .eq("jobs.recruiter_id", id!)
        .eq("job_id", jobId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ApplicantRow[];
    },
  });

  /** Cross-owned-job applicant pool for search (JWT-scoped). */
  const appsAcrossOwned = useQuery({
    queryKey: ["recruiter-agent-applicants-all-owned", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select(APP_SELECT)
        .eq("jobs.recruiter_id", id!)
        .order("created_at", { ascending: false })
        .limit(CROSS_JOB_APP_LIMIT);
      if (error) throw error;
      return (data ?? []) as unknown as ApplicantRow[];
    },
  });

  const selectedJob = useMemo(
    () => jobs.data?.find((j) => j.id === jobId) ?? null,
    [jobs.data, jobId],
  );

  const applicantPool = useMemo(() => {
    if (jobId && appsForJob.data) return appsForJob.data;
    return appsAcrossOwned.data ?? [];
  }, [jobId, appsForJob.data, appsAcrossOwned.data]);

  const selectedApp = useMemo(() => {
    const fromJob = appsForJob.data?.find((a) => a.id === selectedAppId);
    if (fromJob) return fromJob;
    return appsAcrossOwned.data?.find((a) => a.id === selectedAppId) ?? null;
  }, [appsForJob.data, appsAcrossOwned.data, selectedAppId]);

  const pendingShortlistApp = useMemo(() => {
    if (!pendingShortlistAppId) return null;
    return (
      appsForJob.data?.find((a) => a.id === pendingShortlistAppId) ||
      appsAcrossOwned.data?.find((a) => a.id === pendingShortlistAppId) ||
      null
    );
  }, [pendingShortlistAppId, appsForJob.data, appsAcrossOwned.data]);

  /** Hide Confirm once the candidate is already shortlisted (or past applied). */
  const showConfirmShortlistBar = Boolean(
    pendingShortlistAppId &&
      (!pendingShortlistApp || isShortlistableApplicationStatus(pendingShortlistApp.status)),
  );

  const latestDraftTurnId = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const t = turns[i];
      if (t?.role === "assistant" && t.draft) return t.id;
    }
    return null;
  }, [turns]);

  useEffect(() => {
    if (!id) return;
    setConversations(readRecruiterAgentHistory(id).conversations);
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  // Auto-dismiss Confirm chip when applicant is already shortlisted in live data.
  useEffect(() => {
    if (!pendingShortlistAppId || !pendingShortlistApp) return;
    if (!isShortlistableApplicationStatus(pendingShortlistApp.status)) {
      setPendingShortlistAppId(null);
      setTurns((prev) => scrubPendingShortlistFromTurns(prev));
    }
  }, [pendingShortlistAppId, pendingShortlistApp]);

  useEffect(() => {
    activeConversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    if (!id || turns.length === 0) return;
    // Guard against a stale effect writing previous turns onto a newly selected id.
    if (conversationId !== activeConversationIdRef.current) return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    const firstUser = turns.find((t) => t.role === "user");
    const title = firstUser
      ? titleFromRecruiterTurn(firstUser.text)
      : persistTitleRef.current;
    persistTitleRef.current = title;
    const conversation: RecruiterAgentConversation = {
      id: conversationId,
      title,
      updatedAt: new Date().toISOString(),
      // Clone so History list never shares the live turns array reference.
      turns: turns.map((t) => ({ ...t })),
    };
    const store = upsertRecruiterConversation(readRecruiterAgentHistory(id), conversation);
    writeRecruiterAgentHistory(id, store);
    setConversations(store.conversations);
  }, [id, turns, conversationId]);

  function selectJob(nextId: string) {
    setJobId(nextId);
    setSelectedAppId("");
    setPendingShortlistAppId(null);
    setDraftSubject("");
    setDraftBody("");
  }

  function selectApplicant(app: ApplicantRow) {
    setSelectedAppId(app.id);
    if (app.job_id && app.job_id !== jobId) {
      setJobId(app.job_id);
    }
  }

  function appendTurns(...next: RecruiterChatTurn[]) {
    setTurns((prev) => [...prev, ...next]);
  }

  /** Sync current thread to localStorage before switching away (New / History click). */
  function flushCurrentConversation() {
    if (!id || turns.length === 0) return;
    const currentId = activeConversationIdRef.current;
    const prev = readRecruiterAgentHistory(id);
    const existing = prev.conversations.find((c) => c.id === currentId);
    const firstUser = turns.find((t) => t.role === "user");
    const title = firstUser
      ? titleFromRecruiterTurn(firstUser.text)
      : persistTitleRef.current;
    persistTitleRef.current = title;
    const turnsClone = turns.map((t) => ({ ...t }));
    const turnsChanged =
      !existing ||
      existing.turns.length !== turnsClone.length ||
      JSON.stringify(existing.turns) !== JSON.stringify(turnsClone);
    const conversation: RecruiterAgentConversation = {
      id: currentId,
      title,
      // Keep list order stable when only switching threads.
      updatedAt: turnsChanged
        ? new Date().toISOString()
        : (existing?.updatedAt ?? new Date().toISOString()),
      turns: turnsClone,
    };
    const store = turnsChanged
      ? upsertRecruiterConversation(prev, conversation)
      : {
          version: prev.version,
          conversations: prev.conversations.map((c) =>
            c.id === currentId ? conversation : c,
          ),
        };
    writeRecruiterAgentHistory(id, store);
    setConversations(store.conversations);
  }

  function resetTransientChatUi() {
    setQuestion("");
    setEditingTurnId(null);
    setEditDraft("");
    setPendingShortlistAppId(null);
    setDraftSubject("");
    setDraftBody("");
  }

  function applyConversationToUi(target: RecruiterAgentConversation) {
    activeConversationIdRef.current = target.id;
    skipNextPersistRef.current = true;
    const normalized = target.turns.map(normalizeRecruiterChatTurn);
    const pendingId =
      [...normalized]
        .reverse()
        .find((t) => t.role === "assistant" && t.pendingShortlistApplicationId)
        ?.pendingShortlistApplicationId ?? null;
    const pendingRow =
      (pendingId &&
        (appsAcrossOwned.data?.find((a) => a.id === pendingId) ||
          appsForJob.data?.find((a) => a.id === pendingId))) ||
      null;
    const restorePending =
      Boolean(pendingId) &&
      (!pendingRow || isShortlistableApplicationStatus(pendingRow.status));
    const turnsForUi =
      restorePending || !pendingId
        ? normalized
        : scrubPendingShortlistFromTurns(normalized);
    const lastDraft = [...turnsForUi]
      .reverse()
      .find((t) => t.role === "assistant" && t.draft)?.draft;

    resetTransientChatUi();
    setPendingShortlistAppId(restorePending ? pendingId : null);
    setConversationId(target.id);
    setTurns(turnsForUi);
    setDraftSubject(lastDraft?.subject ?? "");
    setDraftBody(lastDraft?.body ?? "");
    persistTitleRef.current = target.title;
    setChatSwitchKey((k) => k + 1);
  }

  function startNewConversation() {
    if (busy) {
      toast.message("Wait for the current reply to finish");
      return;
    }
    flushCurrentConversation();
    const alreadyBlank = turns.length === 0;
    const nextId = createRecruiterConversationId();
    activeConversationIdRef.current = nextId;
    resetTransientChatUi();
    setConversationId(nextId);
    setTurns([]);
    persistTitleRef.current = "New conversation";
    setChatSwitchKey((k) => k + 1);
    toast.message(alreadyBlank ? "Already in a new chat" : "New chat ready");
  }

  function scrubPendingShortlistFromTurns(list: RecruiterChatTurn[]): RecruiterChatTurn[] {
    return list.map((t) =>
      t.role === "assistant" && t.pendingShortlistApplicationId
        ? { ...t, pendingShortlistApplicationId: undefined }
        : t,
    );
  }

  function scrubDraftsFromTurns(list: RecruiterChatTurn[]): RecruiterChatTurn[] {
    return list.map((t) =>
      t.role === "assistant" && t.draft ? { ...t, draft: undefined } : t,
    );
  }

  function openConversation(conversation: RecruiterAgentConversation) {
    if (busy) {
      toast.message("Wait for the current reply to finish");
      return;
    }
    if (conversation.id === activeConversationIdRef.current) return;
    flushCurrentConversation();
    // Always reload from localStorage so we don't show a stale in-memory copy.
    const fresh =
      (id
        ? readRecruiterAgentHistory(id).conversations.find((c) => c.id === conversation.id)
        : null) ?? conversation;
    applyConversationToUi(fresh);
  }

  function handleRename(conversation: RecruiterAgentConversation) {
    if (!id) return;
    const next = window.prompt("Rename conversation", conversation.title);
    if (next == null) return;
    const store = renameRecruiterConversation(
      readRecruiterAgentHistory(id),
      conversation.id,
      next,
    );
    writeRecruiterAgentHistory(id, store);
    setConversations(store.conversations);
    if (conversation.id === conversationId) persistTitleRef.current = next.trim() || conversation.title;
  }

  function handleDelete(conversation: RecruiterAgentConversation) {
    if (!id) return;
    if (!window.confirm("Delete this conversation from this browser?")) return;
    const wasActive = conversation.id === activeConversationIdRef.current;
    const store = deleteRecruiterConversation(readRecruiterAgentHistory(id), conversation.id);
    writeRecruiterAgentHistory(id, store);
    setConversations(store.conversations);
    if (wasActive) {
      // Do not flush — that would re-upsert the deleted thread.
      const nextId = createRecruiterConversationId();
      activeConversationIdRef.current = nextId;
      resetTransientChatUi();
      setConversationId(nextId);
      setTurns([]);
      persistTitleRef.current = "New conversation";
      setChatSwitchKey((k) => k + 1);
    }
  }

  async function runShortlist(
    applicationId: string,
    confirm: boolean,
    options?: { quiet?: boolean },
  ) {
    const result = await ask({
      data: {
        action: "shortlist" as const,
        applicationId,
        status: "shortlisted" as const,
        confirm,
      },
    });
    const parsed = parseShortlistAgentResult(result);
    if (parsed.kind === "error") {
      // Stale Confirm chip after a failed/already-moved status — don't keep proposing forever.
      if (confirm || /already|refresh|pipeline/i.test(parsed.message)) {
        setPendingShortlistAppId(null);
      }
      if (!options?.quiet) {
        appendTurns({
          id: newTurnId(),
          role: "assistant",
          text: parsed.message,
          source: "supervisor",
          error: true,
        });
      }
      toast.error("Shortlist failed", { description: parsed.message });
      await qc.invalidateQueries({ queryKey: ["recruiter-agent-applicants"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-agent-applicants-all-owned"] });
      return parsed;
    }
    if (parsed.needsConfirm) {
      setPendingShortlistAppId(applicationId);
      // Keep chat clean: sticky Confirm bar handles confirmation (no spam bubbles).
      if (!options?.quiet) {
        toast.message("Confirm required", {
          description: "Review the applicant, then Confirm shortlist below.",
          duration: AGENT_TOAST_MS,
        });
      }
      return parsed;
    }
    setPendingShortlistAppId(null);
    // Drop stale Confirm markers from history so reopening chat does not revive the chip.
    setTurns((prev) => [
      ...scrubPendingShortlistFromTurns(prev),
      {
        id: newTurnId(),
        role: "assistant" as const,
        text: `${parsed.message} Status: ${parsed.plannedStatus}.`,
        source: "supervisor" as const,
      },
    ]);
    toast.success("Applicant shortlisted", { duration: AGENT_TOAST_MS });
    await qc.invalidateQueries({ queryKey: ["recruiter-agent-applicants"] });
    await qc.invalidateQueries({ queryKey: ["recruiter-agent-applicants-all-owned"] });
    await qc.invalidateQueries({ queryKey: ["recruiter-jobs-lite"] });
    await qc.invalidateQueries({ queryKey: ["recruiter-applicants"] });
    await qc.invalidateQueries({ queryKey: ["recruiter-pipeline-counts"] });
    await qc.invalidateQueries({ queryKey: ["dash-counts"] });
    return parsed;
  }

  async function runOutreach(
    ownedJobId: string,
    options?: {
      applicationId?: string | null;
      draftKind?: "outreach" | "offer";
      /** Skip adding a user-visible chat bubble (editor Redraft). */
      quietUser?: boolean;
    },
  ) {
    const draftKind = options?.draftKind ?? "outreach";
    const applicationId = options?.applicationId?.trim() || undefined;
    const result = await ask({
      data: {
        action: "draft_outreach" as const,
        jobId: ownedJobId,
        confirmSend: false,
        draftKind,
        ...(applicationId ? { applicationId } : {}),
      },
    });
    const parsed = parseOutreachAgentResult(result);
    if (parsed.kind === "error") {
      appendTurns({
        id: newTurnId(),
        role: "assistant",
        text: parsed.message,
        source: "supervisor",
        error: true,
      });
      toast.error("Draft failed", { description: parsed.message });
      return parsed;
    }
    const body = htmlToEditablePlain(parsed.htmlBody);
    setDraftSubject(parsed.subject);
    setDraftBody(body);
    // Keep a single live draft in chat — replace older draft cards so they do not stack.
    setTurns((prev) => [
      ...scrubDraftsFromTurns(prev),
      {
        id: newTurnId(),
        role: "assistant" as const,
        text: parsed.message,
        source: "supervisor" as const,
        draft: { subject: parsed.subject, body },
      },
    ]);
    toast.success(draftKind === "offer" ? "Offer draft ready" : "Outreach draft ready", {
      duration: AGENT_TOAST_MS,
    });
    return parsed;
  }

  function latestApplicantChoices(): NonNullable<
    Extract<RecruiterChatTurn, { role: "assistant" }>["applicantChoices"]
  > {
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const t = turns[i];
      if (t?.role === "assistant" && t.applicantChoices && t.applicantChoices.length > 0) {
        return t.applicantChoices;
      }
    }
    return [];
  }

  async function runSupervised(text: string, contextJobId?: string, contextAppId?: string) {
    const effectiveJobId = contextJobId || jobId;
    const effectiveAppId = contextAppId || selectedAppId;
    const result = await ask({
      data: {
        action: "supervised" as const,
        question: text,
        ...(effectiveJobId ? { jobId: effectiveJobId } : {}),
        ...(effectiveAppId ? { applicationId: effectiveAppId } : {}),
        confirm: false,
      },
    });
    const asShortlist = parseShortlistAgentResult(result);
    if (asShortlist.kind === "shortlist") {
      if (asShortlist.needsConfirm) {
        const appId = asShortlist.applicationId || effectiveAppId;
        if (appId) setPendingShortlistAppId(appId);
        appendTurns({
          id: newTurnId(),
          role: "assistant",
          text: asShortlist.message,
          source: "supervisor",
          pendingShortlistApplicationId: appId || undefined,
        });
        return;
      }
      appendTurns({
        id: newTurnId(),
        role: "assistant",
        text: `${asShortlist.message} Status: ${asShortlist.plannedStatus}.`,
        source: "supervisor",
      });
      await qc.invalidateQueries({ queryKey: ["recruiter-agent-applicants"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-agent-applicants-all-owned"] });
      return;
    }
    const asOutreach = parseOutreachAgentResult(result);
    if (asOutreach.kind === "outreach") {
      const body = htmlToEditablePlain(asOutreach.htmlBody);
      setDraftSubject(asOutreach.subject);
      setDraftBody(body);
      setTurns((prev) => [
        ...scrubDraftsFromTurns(prev),
        {
          id: newTurnId(),
          role: "assistant" as const,
          text: asOutreach.message,
          source: "supervisor" as const,
          draft: { subject: asOutreach.subject, body },
        },
      ]);
      return;
    }
    const okFlag = (result as { ok?: boolean } | null)?.ok;
    appendTurns({
      id: newTurnId(),
      role: "assistant",
      text: parseSupervisedAgentMessage(result),
      source: "supervisor",
      error: okFlag === false,
    });
  }

  async function replyListJobs(question?: string) {
    const owned = jobs.data ?? [];
    // Sticky job for follow-ups like "show applicants for this job".
    const inferred = inferOwnedJobIdFromContext(owned, {
      currentJobId: jobId || null,
      question: question ?? "list my jobs with applicants",
    });
    if (inferred && inferred !== jobId) selectJob(inferred);

    appendTurns({
      id: newTurnId(),
      role: "assistant",
      text: formatOwnedJobsChatReply(owned, {
        includeApplicantCounts: !question || isListJobsWithApplicantsQuestion(question),
      }),
      source: "local",
    });
  }

  async function loadApplicantsForJob(forJobId: string): Promise<ApplicantRow[]> {
    if (forJobId === jobId && appsForJob.data) return appsForJob.data;
    const { data, error } = await supabase
      .from("applications")
      .select(APP_SELECT)
      .eq("jobs.recruiter_id", id!)
      .eq("job_id", forJobId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as ApplicantRow[];
  }

  async function replyListApplicants(questionText?: string, forJobId?: string) {
    let effectiveJobId = forJobId || jobId;
    let matchedTitle: string | null = null;
    const statusFilter = questionText?.trim()
      ? extractApplicantStatusFilter(questionText)
      : null;

    // Status-only asks ("not shortlisted") should list across owned jobs — do not force a job pick.
    const statusOnlyAsk = Boolean(statusFilter) && !extractJobTitleHint(questionText ?? "");

    // "this job" / only-job-with-applicants when nothing is selected yet.
    if (!effectiveJobId && !statusOnlyAsk) {
      const inferred = inferOwnedJobIdFromContext(jobs.data ?? [], {
        currentJobId: null,
        question: questionText,
      });
      if (inferred) {
        const meta = jobs.data?.find((j) => j.id === inferred);
        selectJob(inferred);
        effectiveJobId = inferred;
        matchedTitle = meta?.title ?? null;
      }
    }

    // "show software developer applicant" → resolve owned job from NL when none selected.
    if (!effectiveJobId && questionText?.trim() && !statusOnlyAsk) {
      const rankedJobs = rankOwnedJobsByQuery(jobs.data ?? [], questionText);
      const matched =
        rankedJobs[0] &&
        (rankedJobs.length === 1 ||
          (rankedJobs[1] != null && rankedJobs[0].score > rankedJobs[1].score))
          ? rankedJobs[0].job
          : matchOwnedJobByTitle(jobs.data ?? [], questionText);
      if (matched) {
        selectJob(matched.id);
        effectiveJobId = matched.id;
        matchedTitle = matched.title;
      }
    }

    let list: ApplicantRow[];
    if (effectiveJobId && !statusOnlyAsk) {
      list = await loadApplicantsForJob(effectiveJobId);
      if (matchedTitle) {
        appendTurns({
          id: newTurnId(),
          role: "assistant",
          text: `Showing applicants for your owned job “${matchedTitle}”.`,
          source: "local" as const,
        });
      }
    } else {
      let pool = appsAcrossOwned.data ?? [];
      if (pool.length === 0) {
        try {
          const refreshed = await appsAcrossOwned.refetch();
          pool = refreshed.data ?? [];
        } catch {
          pool = [];
        }
      }
      list = pool;
      if (!statusFilter) {
        appendTurns({
          id: newTurnId(),
          role: "assistant",
          text:
            "No job selected yet — showing recent applicants across jobs you own. Name a job (e.g. “applicants for Tech Lead”) to narrow the list.",
          source: "local" as const,
        });
      }
    }
    list = applyApplicantStatusFilter(list, statusFilter);
    // Sticky selection for “propose shortlist for the selected applicant”.
    if (list.length === 1) {
      selectApplicant(list[0]!);
    }
    const filterNote = statusFilter
      ? statusFilter.kind === "exclude"
        ? ` (excluding ${statusFilter.statuses.join(", ")})`
        : ` (only ${statusFilter.statuses.join(", ")})`
      : "";
    const ranked = list.map((applicant) => ({
      applicant,
      score: isShortlistableApplicationStatus(applicant.status) ? 60 : 40,
      reasons: [String(applicant.status)],
    }));
    appendTurns({
      id: newTurnId(),
      role: "assistant",
      text: `${formatApplicantsReply(list).replace(
        "Applicants (owned jobs only):",
        `Applicants${filterNote} (owned jobs only):`,
      )}${
        statusFilter
          ? "\n\nOnly “applied” applicants can be shortlisted. Say “propose shortlist for the selected applicant” or tap Propose Shortlist on a card."
          : list.length === 1
            ? "\n\nSelected that applicant for follow-ups (shortlist / outreach)."
            : ""
      }`,
      source: "local" as const,
      applicantChoices: list.length
        ? toApplicantChoices(ranked as never)
        : undefined,
    });
  }

  function toApplicantChoices(
    ranked: ReturnType<typeof rankApplicantsByProfileAndResume>,
  ): NonNullable<Extract<RecruiterChatTurn, { role: "assistant" }>["applicantChoices"]> {
    return ranked.slice(0, 8).map((r) => {
      const label = applicantDisplayName({
        full_name: r.applicant.profiles?.full_name,
        email: r.applicant.profiles?.email,
      });
      return {
        applicationId: r.applicant.id,
        label,
        email: r.applicant.profiles?.email ?? null,
        status: String(r.applicant.status),
        score: r.score,
        meta: `${r.applicant.status}${r.score ? ` · score ${r.score}` : ""}`,
        resumeStoragePath: r.applicant.resume_storage_path ?? null,
        resumeUrl: r.applicant.resume_url ?? null,
        resumeFileName: r.applicant.resume_file_name ?? null,
      };
    });
  }

  async function proposeRankedShortlist(
    text: string,
    forJobId: string,
    jobMeta: { title: string; description?: string | null; status?: string },
  ) {
    const list = await loadApplicantsForJob(forJobId);
    if (list.length === 0) {
      const tip = suggestJobsWithApplicants(jobs.data ?? []);
      appendTurns({
        id: newTurnId(),
        role: "assistant",
        text: `“${jobMeta.title}” is one of your owned jobs, but it has no applicants yet.\n\n${tip}`,
        source: "local",
      });
      return;
    }

    const nameHint = extractApplicantNameHint(text);
    const topN = extractTopNApplicants(text);
    let ranked = rankApplicantsByProfileAndResume(list, text, jobMeta);
    if (nameHint) {
      const byName = list.filter((a) =>
        (a.profiles?.full_name ?? "").toLowerCase().includes(nameHint.toLowerCase()),
      );
      if (byName.length === 1) {
        ranked = [
          {
            applicant: byName[0]!,
            score: 99,
            reasons: [`name matches “${nameHint}”`],
          },
          ...ranked.filter((r) => r.applicant.id !== byName[0]!.id),
        ];
      }
    }

    if (ranked.length === 0) {
      ranked = list.map((applicant) => ({
        applicant,
        score: 0,
        reasons: [] as string[],
      }));
    }

    const visible = topN ? ranked.slice(0, topN) : ranked;
    const top = visible[0]!;
    const topRow = list.find((a) => a.id === top.applicant.id);
    if (topRow) selectApplicant(topRow);

    const topName = applicantDisplayName({
      full_name: top.applicant.profiles?.full_name,
      email: top.applicant.profiles?.email,
    });
    const multiNote =
      topN && visible.length > 1
        ? `\n\nShowing top ${visible.length}. Confirm shortlists one person at a time — top proposal is ${topName}; Select another card to retarget.`
        : `\n\nTop proposal: ${topName}. Use Select / View resume below, then Confirm shortlist in the bar (status does not change until Confirm).`;

    appendTurns({
      id: newTurnId(),
      role: "assistant",
      text: `${formatRankedApplicantsReply(visible, jobMeta.title)}${multiNote}`,
      source: "local" as const,
      applicantChoices: toApplicantChoices(visible),
    });

    await runShortlist(top.applicant.id, false, { quiet: true });
  }

  async function selectAndProposeShortlist(
    applicationId: string,
    options?: { alreadyBusy?: boolean },
  ) {
    if ((!options?.alreadyBusy && busy) || !applicationId) return;
    const row =
      appsForJob.data?.find((a) => a.id === applicationId) ||
      appsAcrossOwned.data?.find((a) => a.id === applicationId) ||
      null;
    if (row) selectApplicant(row);
    const label = row
      ? applicantDisplayName({
          full_name: row.profiles?.full_name,
          email: row.profiles?.email,
        })
      : "Applicant";
    if (row && !isShortlistableApplicationStatus(row.status)) {
      setPendingShortlistAppId(null);
      appendTurns({
        id: newTurnId(),
        role: "assistant",
        text: `${label} is already “${row.status}” — shortlist only moves applicants from “applied”. Pick an applied card, or move a shortlisted person to interview instead.`,
        source: "local" as const,
      });
      return;
    }
    const manageBusy = !options?.alreadyBusy;
    if (manageBusy) setBusy(true);
    try {
      await runShortlist(applicationId, false, { quiet: true });
      toast.message("Applicant selected", {
        description: `${label} — Confirm shortlist below when ready.`,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not propose shortlist.";
      appendTurns({
        id: newTurnId(),
        role: "assistant",
        text: message,
        source: "local" as const,
        error: true,
      });
    } finally {
      if (manageBusy) setBusy(false);
    }
  }

  async function handleShortlistIntent(text: string) {
    const ordinalRef = extractApplicantOrdinalRef(text);
    if (ordinalRef) {
      const choices = latestApplicantChoices();
      const resolved = resolveApplicantChoiceFromRef(
        choices,
        ordinalRef,
        selectedAppId || pendingShortlistAppId,
      );
      if (resolved?.applicationId) {
        setPendingShortlistAppId(null);
        await selectAndProposeShortlist(resolved.applicationId, { alreadyBusy: true });
        return;
      }
      if (ordinalRef.kind === "index") {
        appendTurns({
          id: newTurnId(),
          role: "assistant",
          text: `I don’t have a ranked list yet to pick candidate #${ordinalRef.index + 1}. Rank applicants first (e.g. “find the best candidates” or “shortlist from <job>”), then say “the second candidate”.`,
          source: "local" as const,
        });
        return;
      }
      appendTurns({
        id: newTurnId(),
        role: "assistant",
        text: `I need a specific applicant for that. Select a card, say a name, or rank candidates first — then “move him/her to shortlisted” or “shortlist this candidate” will work.`,
        source: "local" as const,
      });
      return;
    }

    const nameHints = extractApplicantNameHints(text);
    // Prefer explicit person name(s) over a stale Confirm chip (e.g. previous Dibyo proposal).
    if (nameHints.length > 0) {
      // Clear stale Confirm bar until we propose a matching applicant.
      setPendingShortlistAppId(null);
      let pool = applicantPool;
      if (pool.length === 0) {
        try {
          const refreshed = await appsAcrossOwned.refetch();
          pool = refreshed.data ?? [];
        } catch {
          pool = [];
        }
      }
      const byName: ApplicantRow[] = [];
      const seen = new Set<string>();
      for (const hint of nameHints) {
        for (const row of matchApplicantsByNameHint(pool, hint)) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          byName.push(row);
        }
      }
      const actionable = preferShortlistableApplicants(byName);
      if (
        actionable.length > 0 &&
        actionable.every((a) => !isShortlistableApplicationStatus(a.status))
      ) {
        const label = applicantDisplayName({
          full_name: actionable[0]!.profiles?.full_name,
          email: actionable[0]!.profiles?.email,
        });
        appendTurns({
          id: newTurnId(),
          role: "assistant",
          text: `${label} already has status “${actionable[0]!.status}” on your owned jobs — nothing left to shortlist. Select an “applied” applicant, or move a shortlisted person to interview.`,
          source: "local" as const,
          applicantChoices: toApplicantChoices(
            actionable.map((applicant) => ({
              applicant,
              score: 50,
              reasons: [`already ${applicant.status}`],
            })) as never,
          ),
        });
        return;
      }
      if (actionable.length === 1) {
        await selectAndProposeShortlist(actionable[0]!.id, { alreadyBusy: true });
        return;
      }
      if (actionable.length > 1) {
        const ranked = actionable.map((applicant) => ({
          applicant,
          score: 50,
          reasons: [`name matches “${nameHints.join(", ")}”`],
        }));
        appendTurns({
          id: newTurnId(),
          role: "assistant",
          text: `I found ${actionable.length} shortlistable applicants matching “${nameHints.join(", ")}” (already-shortlisted rows hidden). Select one below, then Confirm shortlist.`,
          source: "local" as const,
          applicantChoices: toApplicantChoices(ranked as never),
        });
        return;
      }
      appendTurns({
        id: newTurnId(),
        role: "assistant",
        text: `I couldn’t find “${nameHints.join(", ")}” among applicants on jobs you own. Use Select on a card, or say “shortlist from <job title>”.`,
        source: "local" as const,
      });
      return;
    }

    const hint = extractJobTitleHint(text);
    const rankedJobs = rankOwnedJobsByQuery(jobs.data ?? [], text);
    const matched =
      (hint ? matchOwnedJobByTitle(jobs.data ?? [], hint) : null) ??
      (rankedJobs[0] &&
      (rankedJobs.length === 1 ||
        (rankedJobs[1] != null && rankedJobs[0].score > rankedJobs[1].score))
        ? rankedJobs[0].job
        : null);

    if (matched) {
      selectJob(matched.id);
      appendTurns({
        id: newTurnId(),
        role: "assistant",
        text: `Using your owned job “${matched.title}” (${matched.status}). Ranking applicants from profile, cover note, and resume signals…`,
        source: "local" as const,
      });
      await proposeRankedShortlist(text, matched.id, matched);
      return;
    }

    if (rankedJobs.length > 1) {
      const lines = rankedJobs
        .slice(0, 8)
        .map((r, i) => `${i + 1}. ${r.job.title} (${r.job.status}) — match ${r.score}`)
        .join("\n");
      appendTurns({
        id: newTurnId(),
        role: "assistant",
        text: `I found several owned jobs that might match. Which one?\n${lines}\n\nReply like “shortlist from ${rankedJobs[0]!.job.title}”.`,
        source: "local" as const,
      });
      return;
    }

    const appId = selectedAppId || pendingShortlistAppId;
    if (appId) {
      await runShortlist(appId, false);
      return;
    }

    // Last listed applicants (e.g. after “show applicants…”) even if sticky id wasn’t set yet.
    const recentChoices = latestApplicantChoices();
    if (recentChoices.length > 0) {
      const fromRecent = resolveApplicantChoiceFromRef(
        recentChoices,
        { kind: "pronoun" },
        null,
      );
      if (fromRecent?.applicationId) {
        await selectAndProposeShortlist(fromRecent.applicationId, { alreadyBusy: true });
        return;
      }
    }

    const inferredJobId = inferOwnedJobIdFromContext(jobs.data ?? [], {
      currentJobId: jobId || null,
      question: text,
    });
    if (inferredJobId) {
      const meta = jobs.data?.find((j) => j.id === inferredJobId);
      if (meta) {
        selectJob(inferredJobId);
        await proposeRankedShortlist(text, inferredJobId, meta);
        return;
      }
    }

    if (jobId && selectedJob) {
      await proposeRankedShortlist(text, jobId, selectedJob);
      return;
    }

    appendTurns({
      id: newTurnId(),
      role: "assistant",
      text: `I couldn’t tell which owned job you mean. Here are jobs under your account:\n${formatOwnedJobsChatReply(jobs.data ?? [], { plain: true })}\n\nSay “show applicants for Tech Lead”, then “propose shortlist for the selected applicant”.`,
      source: "local" as const,
    });
  }

  /**
   * "confirm" / "conifrm rajon" / "yes" — retarget or execute pending shortlist.
   * Prevents the owned-jobs dump loop when confirm typos are not recognized.
   */
  async function handleConfirmShortlistIntent(text: string) {
    const nameHint = extractApplicantNameHint(text);
    if (nameHint) {
      let pool = applicantPool;
      if (pool.length === 0) {
        try {
          const refreshed = await appsAcrossOwned.refetch();
          pool = refreshed.data ?? [];
        } catch {
          pool = [];
        }
      }
      const byName = preferShortlistableApplicants(matchApplicantsByNameHint(pool, nameHint));
      if (
        byName.length > 0 &&
        byName.every((a) => !isShortlistableApplicationStatus(a.status))
      ) {
        const app = byName[0]!;
        const label = applicantDisplayName({
          full_name: app.profiles?.full_name,
          email: app.profiles?.email,
        });
        setPendingShortlistAppId(null);
        appendTurns({
          id: newTurnId(),
          role: "assistant",
          text: `${label} is already “${app.status}” — Confirm shortlist only works from “applied”.`,
          source: "local" as const,
        });
        return;
      }
      if (byName.length === 1) {
        const app = byName[0]!;
        selectApplicant(app);
        // Retarget sticky Confirm bar away from a stale proposal (e.g. Dibyo → Rajon).
        await runShortlist(app.id, false, { quiet: true });
        const label = applicantDisplayName({
          full_name: app.profiles?.full_name,
          email: app.profiles?.email,
        });
        appendTurns({
          id: newTurnId(),
          role: "assistant",
          text: `Proposed shortlist for ${label}. Status changes only after you confirm — click Confirm shortlist below, or say “confirm”.`,
          source: "local" as const,
          pendingShortlistApplicationId: app.id,
        });
        return;
      }
      if (byName.length > 1) {
        const ranked = byName.map((applicant) => ({
          applicant,
          score: 50,
          reasons: [`name matches “${nameHint}”`],
        }));
        appendTurns({
          id: newTurnId(),
          role: "assistant",
          text: `I found ${byName.length} shortlistable applicants matching “${nameHint}”. Select the right person below, then Confirm shortlist.`,
          source: "local" as const,
          applicantChoices: toApplicantChoices(ranked as never),
        });
        return;
      }
      appendTurns({
        id: newTurnId(),
        role: "assistant",
        text: `I couldn’t find “${nameHint}” among applicants on jobs you own. Say “show all applicants”, Select a card, then Confirm shortlist.`,
        source: "local" as const,
      });
      return;
    }

    const appId = selectedAppId || pendingShortlistAppId;
    if (appId) {
      const row =
        appsForJob.data?.find((a) => a.id === appId) ||
        appsAcrossOwned.data?.find((a) => a.id === appId) ||
        null;
      if (row && !isShortlistableApplicationStatus(row.status)) {
        setPendingShortlistAppId(null);
        const label = applicantDisplayName({
          full_name: row.profiles?.full_name,
          email: row.profiles?.email,
        });
        appendTurns({
          id: newTurnId(),
          role: "assistant",
          text: `${label} is already “${row.status}” — Confirm shortlist only works from “applied”.`,
          source: "local" as const,
        });
        return;
      }
      await runShortlist(appId, true);
      return;
    }

    appendTurns({
      id: newTurnId(),
      role: "assistant",
      text: `Nothing is pending to confirm yet. Select an applicant (or say “confirm <name>”), then Confirm shortlist.`,
      source: "local" as const,
    });
  }

  async function ensureApplicantPool(): Promise<ApplicantRow[]> {
    let pool = applicantPool;
    if (pool.length === 0) {
      try {
        const refreshed = await appsAcrossOwned.refetch();
        pool = refreshed.data ?? [];
      } catch {
        pool = [];
      }
    }
    return pool;
  }

  function choiceFromApplicantRow(
    row: ApplicantRow,
  ): NonNullable<Extract<RecruiterChatTurn, { role: "assistant" }>["applicantChoices"]>[number] {
    const label = applicantDisplayName({
      full_name: row.profiles?.full_name,
      email: row.profiles?.email,
    });
    return {
      applicationId: row.id,
      label,
      email: row.profiles?.email ?? null,
      status: String(row.status),
      score: 0,
      meta: String(row.status),
      resumeStoragePath: row.resume_storage_path ?? null,
      resumeUrl: row.resume_url ?? null,
      resumeFileName: row.resume_file_name ?? null,
    };
  }

  /** Open resume for an owned applicant via signed URL; never bypass RLS. */
  async function openResumeForOwnedApplicant(row: ApplicantRow) {
    selectApplicant(row);
    const label = applicantDisplayName({
      full_name: row.profiles?.full_name,
      email: row.profiles?.email,
    });
    const hasResume = Boolean(row.resume_storage_path || row.resume_url);
    if (!hasResume) {
      appendTurns({
        id: newTurnId(),
        role: "assistant",
        text: `No resume on file for ${label}.`,
        source: "local" as const,
        applicantChoices: [choiceFromApplicantRow(row)],
      });
      return;
    }

    let opened = false;
    let denied = false;
    try {
      if (row.resume_storage_path) {
        const href = await resolveDisplayUrl(row.resume_storage_path, "resume");
        if (href) {
          window.open(href, "_blank", "noopener,noreferrer");
          opened = true;
        } else {
          denied = true;
        }
      } else if (row.resume_url) {
        window.open(row.resume_url, "_blank", "noopener,noreferrer");
        opened = true;
      }
    } catch {
      denied = true;
    }

    if (denied && !opened) {
      appendTurns({
        id: newTurnId(),
        role: "assistant",
        text: RECRUITER_RESUME_ACCESS_DENIED_MESSAGE,
        source: "local" as const,
      });
      return;
    }

    appendTurns({
      id: newTurnId(),
      role: "assistant",
      text: opened
        ? `Opening resume for ${label}. If the tab was blocked, use View resume below.`
        : `Resume for ${label} is available below.`,
      source: "local" as const,
      applicantChoices: [choiceFromApplicantRow(row)],
    });
  }

  /**
   * "open jia resume" / "open Priya das resume":
   * only applicants on jobs this recruiter owns; else Access Denied (no owned-list dump).
   */
  async function handleOpenResumeIntent(text: string) {
    const pool = await ensureApplicantPool();
    const nameHint = extractResumeOpenNameHint(text) ?? extractApplicantNameHint(text);

    if (nameHint) {
      const matches = matchApplicantsByNameHint(pool, nameHint);
      if (matches.length === 0) {
        appendTurns({
          id: newTurnId(),
          role: "assistant",
          text: RECRUITER_RESUME_ACCESS_DENIED_MESSAGE,
          source: "local" as const,
        });
        return;
      }
      if (matches.length > 1) {
        const ranked = matches.map((applicant) => ({
          applicant,
          score: 50,
          reasons: ["name match"],
        }));
        appendTurns({
          id: newTurnId(),
          role: "assistant",
          text: `I found more than one “${nameHint}”. Pick one and use View resume (I won’t open blindly).`,
          source: "local" as const,
          applicantChoices: toApplicantChoices(ranked as never),
        });
        return;
      }
      await openResumeForOwnedApplicant(matches[0]!);
      return;
    }

    const selected =
      (selectedAppId &&
        (appsForJob.data?.find((a) => a.id === selectedAppId) ||
          appsAcrossOwned.data?.find((a) => a.id === selectedAppId))) ||
      (pendingShortlistAppId &&
        (appsForJob.data?.find((a) => a.id === pendingShortlistAppId) ||
          appsAcrossOwned.data?.find((a) => a.id === pendingShortlistAppId))) ||
      null;

    if (selected) {
      await openResumeForOwnedApplicant(selected);
      return;
    }

    appendTurns({
      id: newTurnId(),
      role: "assistant",
      text: "Tell me which applicant’s resume to open (e.g. “open Priya resume”), or Select an applicant first. I can only open resumes for people who applied to jobs you own.",
      source: "local" as const,
    });
  }

  /** Noisy / incomplete questions: browse owned jobs first, then applicants. */
  async function handleBrowseIntent(text: string) {
    const owned = jobs.data ?? [];
    const rankedJobs = rankOwnedJobsByQuery(owned, text);

    if (rankedJobs.length === 0) {
      // Name-like leftovers (e.g. "rajon") should retarget applicants — not dump jobs again.
      let pool = applicantPool;
      if (pool.length === 0) {
        try {
          const refreshed = await appsAcrossOwned.refetch();
          pool = refreshed.data ?? [];
        } catch {
          pool = [];
        }
      }
      // Avoid "select select priya" — text may already include select/pick.
      const nameGuess =
        extractApplicantNameHint(/\b(select|pick|choose)\b/i.test(text) ? text : `select ${text}`) ??
        text.replace(/^\s*(select|pick|choose)\s+/i, "").trim();
      const byName = nameGuess ? matchApplicantsByNameHint(pool, nameGuess) : [];
      if (byName.length === 1) {
        await selectAndProposeShortlist(byName[0]!.id, { alreadyBusy: true });
        return;
      }
      if (byName.length > 1) {
        const ranked = byName.map((applicant) => ({
          applicant,
          score: 50,
          reasons: [`name matches “${nameGuess}”`],
        }));
        appendTurns({
          id: newTurnId(),
          role: "assistant",
          text: `I couldn’t match a job title, but found ${byName.length} applicants for “${nameGuess}”. Select one below.`,
          source: "local" as const,
          applicantChoices: toApplicantChoices(ranked as never),
        });
        return;
      }
      appendTurns({
        id: newTurnId(),
        role: "assistant",
        text: `I couldn’t match that to a job or applicant. Try “select <name>”, “show all applicants”, or “shortlist from <job title>”.\n\nYour owned jobs:\n${formatOwnedJobsChatReply(owned, { plain: true })}`,
        source: "local" as const,
      });
      return;
    }

    if (
      rankedJobs.length === 1 ||
      (rankedJobs[0] && rankedJobs[1] && rankedJobs[0].score > rankedJobs[1].score)
    ) {
      const job = rankedJobs[0]!.job;
      selectJob(job.id);
      appendTurns({
        id: newTurnId(),
        role: "assistant",
        text: `Matched owned job “${job.title}” (${job.status}). Ranking applicants by profile / cover note / resume…`,
        source: "local" as const,
      });
      await proposeRankedShortlist(text, job.id, job);
      return;
    }

    const lines = rankedJobs
      .slice(0, 8)
      .map((r, i) => `${i + 1}. ${r.job.title} (${r.job.status}) — match ${r.score}`)
      .join("\n");
    appendTurns({
      id: newTurnId(),
      role: "assistant",
      text: `Possible owned jobs for that ask:\n${lines}\n\nName one to shortlist/rank applicants (example: “shortlist from ${rankedJobs[0]!.job.title}”).`,
      source: "local" as const,
    });
  }

  function beginEditTurn(turn: RecruiterChatTurn) {
    if (busy || turn.role !== "user") return;
    setEditingTurnId(turn.id);
    setEditDraft(turn.text);
    queueMicrotask(() => editInputRef.current?.focus());
  }

  function cancelEditTurn() {
    setEditingTurnId(null);
    setEditDraft("");
  }

  async function submitChat(raw: string, options?: { editTurnId?: string }) {
    const text = raw.trim();
    if (!text || busy || !id) return;
    setQuestion("");
    setEditingTurnId(null);
    setEditDraft("");
    if (options?.editTurnId) {
      setTurns((prev) => {
        const idx = prev.findIndex((t) => t.id === options.editTurnId);
        if (idx < 0) return prev;
        return [
          ...prev.slice(0, idx),
          { id: options.editTurnId!, role: "user", text },
        ];
      });
    } else {
      appendTurns({ id: newTurnId(), role: "user", text });
    }
    setBusy(true);
    try {
      const intent = detectRecruiterChatIntent(text);
      if (intent === "help") {
        appendTurns({
          id: newTurnId(),
          role: "assistant",
          text: RECRUITER_SHORTLIST_PROCESS_HELP,
          source: "local" as const,
        });
        return;
      }
      if (intent === "list_jobs") {
        await replyListJobs(text);
        return;
      }
      if (intent === "list_applicants") {
        await replyListApplicants(text);
        return;
      }
      if (intent === "shortlist") {
        await handleShortlistIntent(text);
        return;
      }
      if (intent === "confirm_shortlist") {
        await handleConfirmShortlistIntent(text);
        return;
      }
      if (intent === "draft_outreach") {
        const draftKind = isOfferDraftishQuestion(text) ? ("offer" as const) : ("outreach" as const);
        const hint = extractJobTitleHint(text);
        let targetJobId = jobId;
        let targetAppId = selectedAppId || pendingShortlistAppId;

        const ordinalRef = extractApplicantOrdinalRef(text);
        if (ordinalRef) {
          const resolved = resolveApplicantChoiceFromRef(
            latestApplicantChoices(),
            ordinalRef,
            targetAppId,
          );
          if (resolved?.applicationId) {
            targetAppId = resolved.applicationId;
            setSelectedAppId(resolved.applicationId);
          }
        }

        const nameHints = extractApplicantNameHints(text);
        if (nameHints.length > 0) {
          let pool = applicantPool;
          if (pool.length === 0) {
            try {
              const refreshed = await appsAcrossOwned.refetch();
              pool = refreshed.data ?? [];
            } catch {
              pool = [];
            }
          }
          const byName = matchApplicantsByNameHint(pool, nameHints[0]!);
          if (byName.length === 1) {
            targetAppId = byName[0]!.id;
            targetJobId = byName[0]!.job_id;
            selectApplicant(byName[0]!);
          }
        }

        if (hint) {
          const matched = matchOwnedJobByTitle(jobs.data ?? [], hint);
          if (matched) {
            targetJobId = matched.id;
            selectJob(matched.id);
          }
        } else if (!targetJobId) {
          const inferred = inferOwnedJobIdFromContext(jobs.data ?? [], {
            currentJobId: null,
            question: text,
          });
          if (inferred) {
            targetJobId = inferred;
            selectJob(inferred);
          } else {
            const ranked = rankOwnedJobsByQuery(jobs.data ?? [], text);
            if (ranked.length === 1) {
              targetJobId = ranked[0]!.job.id;
              selectJob(targetJobId);
            }
          }
        }
        // Reuse job from selected / pending shortlist applicant when chat has context.
        if (!targetJobId) {
          const contextApp =
            (targetAppId &&
              (appsForJob.data?.find((a) => a.id === targetAppId) ||
                appsAcrossOwned.data?.find((a) => a.id === targetAppId))) ||
            null;
          if (contextApp?.job_id) {
            targetJobId = contextApp.job_id;
            selectJob(contextApp.job_id);
            setSelectedAppId(contextApp.id);
            targetAppId = contextApp.id;
          }
        }
        if (!targetJobId) {
          appendTurns({
            id: newTurnId(),
            role: "assistant",
            text:
              draftKind === "offer"
                ? "Select an owned job and applicant first (or name them), then ask me to draft an offer. Nothing is emailed until you explicitly send."
                : "Select an owned job first (or name it), then ask me to draft outreach. Emails are never sent from this page.",
            source: "local" as const,
          });
          return;
        }
        if (draftKind === "offer" && !targetAppId) {
          appendTurns({
            id: newTurnId(),
            role: "assistant",
            text: `I can draft against “${
              jobs.data?.find((j) => j.id === targetJobId)?.title ?? "this job"
            }”, but I need an applicant (Select a card, or say “offer for <name>”). I will not invent candidate details or send email.`,
            source: "local" as const,
          });
          return;
        }
        await runOutreach(targetJobId, { applicationId: targetAppId, draftKind });
        return;
      }
      if (intent === "open_resume") {
        await handleOpenResumeIntent(text);
        return;
      }
      if (intent === "browse") {
        await handleBrowseIntent(text);
        return;
      }
      await runSupervised(text);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Agent request failed.";
      appendTurns({
        id: newTurnId(),
        role: "assistant",
        text: message,
        source: "local" as const,
        error: true,
      });
      toast.error("Agent failed", { description: message });
    } finally {
      setBusy(false);
    }
  }

  const confirmShortlist = useMutation({
    mutationFn: async (applicationId: string) => runShortlist(applicationId, true),
    onError: (e: Error) => toast.error("Confirm failed", { description: e.message }),
  });

  const filteredHistory = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, historyQuery]);

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-4rem)] flex-col overflow-hidden bg-[#f4f7f6] sm:-mx-6 sm:-my-8 lg:-mx-10 lg:-my-12 lg:flex-row">
      {/* History rail — right edge border keeps this panel reading as a clear box */}
      <aside className="flex max-h-[40vh] w-full shrink-0 flex-col border-b border-border bg-white lg:max-h-none lg:h-full lg:w-72 lg:border-b-0 lg:border-r lg:border-border">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3.5 py-3">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            History
          </h2>
          <button
            type="button"
            onClick={startNewConversation}
            className="inline-flex items-center gap-1 rounded-full bg-signal/12 px-2.5 py-1 text-[11px] font-semibold text-signal transition-[background-color,transform] duration-150 hover:bg-signal/20 active:scale-[0.98]"
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
                    className="min-w-0 flex-1 rounded-lg px-1 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-signal/30"
                    aria-current={active ? "true" : undefined}
                    onClick={() => openConversation(c)}
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
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "mt-0.5 shrink-0 rounded-md p-1.5 text-muted-foreground transition-[opacity,background-color,color] duration-150 hover:bg-muted hover:text-foreground",
                          active
                            ? "opacity-90"
                            : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
                        )}
                        aria-label="Conversation actions"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40 rounded-xl">
                      <DropdownMenuItem
                        onSelect={() => handleRename(c)}
                        className="gap-2 text-xs"
                      >
                        <Pencil className="size-3.5" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => handleDelete(c)}
                        className="gap-2 text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Main workspace — fills remaining height */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#f8faf9]">
        <header className="shrink-0 border-b border-border/80 bg-white px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-signal/25 bg-signal-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-signal">
                  <Zap className="size-3.5" aria-hidden />
                  Recruiter Supervisor
                </span>
                <span className="text-xs text-muted-foreground">Autonomous Copilot</span>
              </div>
              <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                AI Recruiter Agent
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Search owned jobs, shortlist applicants, and draft outreach. Emails are never sent
                from this page.
              </p>
            </div>
            <div className="flex items-center self-start rounded-xl border border-border/70 bg-muted/80 p-1 md:self-end">
              <Link
                to="/recruiter/jobs"
                className="inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white hover:text-foreground"
              >
                <Briefcase className="size-3.5" aria-hidden />
                Job Posts
              </Link>
              <Link
                to="/recruiter/applicants"
                className="inline-flex items-center gap-2 rounded-lg bg-signal px-3.5 py-1.5 text-xs font-semibold text-signal-foreground shadow-xs"
              >
                <Users className="size-3.5 opacity-90" aria-hidden />
                Applicants
              </Link>
            </div>
          </div>
        </header>

        <section
          key={chatSwitchKey}
          className="flex min-h-0 flex-1 animate-fade-up flex-col overflow-hidden bg-white"
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
            {turns.length === 0 ? (
              <div className="flex h-full min-h-[18rem] flex-col items-center justify-center text-center">
                <div className="mb-5 flex size-14 items-center justify-center rounded-2xl border border-signal/25 bg-signal-soft text-signal shadow-sm">
                  <Bot className="size-7" aria-hidden />
                </div>
                <h3 className="text-lg font-bold tracking-tight text-foreground">
                  Ask your recruiter supervisor
                </h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  List owned jobs, review applicants, propose shortlists, or draft outreach.
                  Shortlist needs your confirm.
                </p>
                <div className="mt-7 flex max-w-2xl flex-wrap items-center justify-center gap-2">
                  {STARTERS.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      disabled={busy || !jobs.data?.length}
                      onClick={() => void submitChat(starter)}
                      className="rounded-xl border border-border bg-[#f8faf9] px-3.5 py-2.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:border-signal/40 hover:bg-signal-soft hover:text-signal disabled:opacity-50"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto w-full max-w-3xl space-y-5">
                {turns.map((t, turnIndex) => {
                  const editIdx = editingTurnId
                    ? turns.findIndex((x) => x.id === editingTurnId)
                    : -1;
                  if (editIdx >= 0 && turnIndex > editIdx) return null;

                  return t.role === "user" ? (
                    <div key={t.id} className="flex justify-end">
                      <div className="group relative max-w-[min(100%,36rem)]">
                        {editingTurnId === t.id ? (
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
                                onClick={() => void submitChat(editDraft, { editTurnId: t.id })}
                              >
                                Save & send
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="relative select-text rounded-2xl rounded-br-md bg-signal/15 px-4 py-3 text-sm leading-relaxed text-foreground">
                            <p className="select-text">{t.text}</p>
                            <button
                              type="button"
                              className="absolute -left-9 top-1 inline-flex size-7 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-100 shadow-sm transition hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100"
                              aria-label="Edit message"
                              disabled={busy}
                              onClick={() => beginEditTurn(t)}
                            >
                              <Pencil className="size-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div key={t.id} className="space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-signal/10 text-signal">
                          <Bot className="size-4" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1 space-y-3">
                          <div
                            className={cn(
                              "rounded-2xl rounded-tl-md border px-4 py-3.5",
                              t.error
                                ? "border-destructive/20 bg-destructive/5"
                                : "border-border/70 bg-[#fbfcfc]",
                            )}
                          >
                            {t.error ? (
                              <p className="text-sm text-destructive">{t.text}</p>
                            ) : (
                              <AssistantMessageBody
                                text={t.text}
                                selectedJobTitle={selectedJob?.title ?? null}
                                onPickListItem={(title) => {
                                  void (async () => {
                                    const cleaned = title.replace(/\s*\([^)]*\)\s*$/, "").trim();
                                    const owned = jobs.data ?? [];
                                    const matched =
                                      matchOwnedJobByTitle(owned, cleaned) ??
                                      matchOwnedJobByTitle(owned, title);
                                    if (!matched) {
                                      toast.message("Couldn’t match that job", {
                                        description:
                                          "Try naming it in chat, e.g. shortlist from Tech Lead.",
                                      });
                                      return;
                                    }
                                    selectJob(matched.id);
                                    toast.message(`Selected “${matched.title}”`);
                                    if (busy) return;
                                    setBusy(true);
                                    try {
                                      await replyListApplicants(
                                        `show applicants for ${matched.title}`,
                                        matched.id,
                                      );
                                    } catch (err) {
                                      const message =
                                        err instanceof Error
                                          ? err.message
                                          : "Could not load applicants.";
                                      toast.error(message);
                                    } finally {
                                      setBusy(false);
                                    }
                                  })();
                                }}
                              />
                            )}
                          </div>

                          {t.applicantChoices && t.applicantChoices.length > 0 ? (
                            <div className="grid gap-3 sm:grid-cols-2">
                              {t.applicantChoices.map((choice) => {
                                const active =
                                  selectedAppId === choice.applicationId ||
                                  pendingShortlistAppId === choice.applicationId;
                                const hasResume = Boolean(
                                  choice.resumeStoragePath || choice.resumeUrl,
                                );
                                return (
                                  <div
                                    key={choice.applicationId}
                                    className={cn(
                                      "rounded-xl border bg-white p-4 transition-colors",
                                      active
                                        ? "border-signal/40 bg-signal/5"
                                        : "border-border hover:border-signal/30",
                                    )}
                                  >
                                    <div className="flex items-start gap-3">
                                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-signal/15 text-[11px] font-bold text-signal">
                                        {personInitials(choice.label || "A")}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-semibold">
                                          {choice.label}
                                        </p>
                                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                          {choice.meta}
                                          {choice.email ? ` · ${choice.email}` : ""}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant={active ? "signal" : "outline"}
                                        disabled={busy || confirmShortlist.isPending}
                                        onClick={() =>
                                          void selectAndProposeShortlist(choice.applicationId)
                                        }
                                      >
                                        {active ? "Selected" : "Propose Shortlist"}
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={busy}
                                        onClick={() => {
                                          const ownedApps = [
                                            ...(appsForJob.data ?? []),
                                            ...(appsAcrossOwned.data ?? []),
                                          ];
                                          const row = ownedApps.find(
                                            (a) => a.id === choice.applicationId,
                                          );
                                          const outreachJobId = row?.job_id || jobId;
                                          setSelectedAppId(choice.applicationId);
                                          if (row?.job_id) setJobId(row.job_id);
                                          if (!outreachJobId) {
                                            toast.error("Select a job first");
                                            return;
                                          }
                                          void (async () => {
                                            setBusy(true);
                                            try {
                                              await runOutreach(outreachJobId, {
                                                applicationId: choice.applicationId,
                                              });
                                            } finally {
                                              setBusy(false);
                                            }
                                          })();
                                        }}
                                      >
                                        Draft Outreach
                                      </Button>
                                      {hasResume ? (
                                        <ResumeOpenLink
                                          storagePath={choice.resumeStoragePath ?? null}
                                          legacyUrl={choice.resumeUrl ?? null}
                                          fileName={choice.resumeFileName || "View"}
                                        />
                                      ) : null}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}

                          {t.draft && t.id === latestDraftTurnId ? (
                            <div className="max-w-xl space-y-2 rounded-xl border border-border bg-white p-4">
                              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                                <Mail className="size-3.5" aria-hidden />
                                Outreach draft (not sent)
                              </div>
                              <p className="text-sm font-medium">{t.draft.subject}</p>
                              <p className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                                {t.draft.body.slice(0, 280)}
                                {t.draft.body.length > 280 ? "…" : ""}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {busy ? <RecruiterAgentLoading label="Running via Supervisor…" /> : null}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {showConfirmShortlistBar && pendingShortlistAppId ? (
            <div className="shrink-0 space-y-2 border-t border-signal/20 bg-signal/5 px-4 py-3 sm:px-6">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-signal">
                Confirm shortlist
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  Proposed:{" "}
                  <span className="font-medium">
                    {pendingShortlistApp || selectedApp
                      ? applicantDisplayName({
                          full_name:
                            (pendingShortlistApp ?? selectedApp)?.profiles?.full_name,
                          email: (pendingShortlistApp ?? selectedApp)?.profiles?.email,
                        })
                      : "Selected applicant"}
                  </span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="signal"
                    disabled={busy || confirmShortlist.isPending}
                    onClick={() => void confirmShortlist.mutateAsync(pendingShortlistAppId)}
                  >
                    {confirmShortlist.isPending ? (
                      <>
                        <Loader2 className="animate-spin" /> Confirming…
                      </>
                    ) : (
                      "Confirm shortlist"
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || confirmShortlist.isPending}
                    onClick={() => {
                      setPendingShortlistAppId(null);
                      setTurns((prev) => scrubPendingShortlistFromTurns(prev));
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
              {((pendingShortlistApp ?? selectedApp)?.resume_storage_path ||
                (pendingShortlistApp ?? selectedApp)?.resume_url) && (
                <ResumeOpenLink
                  storagePath={
                    (pendingShortlistApp ?? selectedApp)?.resume_storage_path ?? null
                  }
                  legacyUrl={(pendingShortlistApp ?? selectedApp)?.resume_url ?? null}
                  fileName={
                    (pendingShortlistApp ?? selectedApp)?.resume_file_name || "View resume"
                  }
                />
              )}
            </div>
          ) : null}

          {(draftSubject || draftBody) && (
            <div className="shrink-0 space-y-3 border-t bg-muted/20 px-4 py-3 sm:px-6">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Mail className="size-4 text-signal" aria-hidden />
                Outreach draft editor
              </h2>
              <Input
                id="outreach-subject"
                value={draftSubject}
                onChange={(e) => setDraftSubject(e.target.value)}
                placeholder="Subject"
              />
              <Textarea
                id="outreach-body"
                rows={5}
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                className="font-mono text-xs"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(`${draftSubject}\n\n${draftBody}`);
                      toast.success("Draft copied");
                    } catch {
                      toast.error("Could not copy draft");
                    }
                  }}
                >
                  <Copy /> Copy draft
                </Button>
                {jobId ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="signal"
                    disabled={busy}
                    onClick={() => {
                      void (async () => {
                        setBusy(true);
                        try {
                          await runOutreach(jobId, {
                            applicationId: selectedAppId || pendingShortlistAppId,
                            quietUser: true,
                          });
                        } finally {
                          setBusy(false);
                        }
                      })();
                    }}
                  >
                    Redraft via Supervisor
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setDraftSubject("");
                    setDraftBody("");
                    setTurns((prev) => scrubDraftsFromTurns(prev));
                  }}
                >
                  Dismiss draft
                </Button>
              </div>
            </div>
          )}

              <div className="shrink-0 border-t border-border/80 bg-[#f8faf9] px-4 py-3 sm:px-6">
            {!jobs.isLoading && !jobs.data?.length ? (
              <div
                className="mx-auto mb-3 max-w-3xl rounded-xl border border-border bg-white px-3.5 py-3 text-sm shadow-xs"
                role="status"
              >
                <p className="font-semibold tracking-tight text-foreground">
                  Post a job to unlock the Recruiter Agent
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Shortlist and outreach need at least one owned job listing (pending or approved).
                  Create a company if needed, then post a role.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="signal" className="h-8 rounded-lg px-3 text-xs">
                    <Link to="/recruiter/jobs/new">Post a job</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline" className="h-8 rounded-lg px-3 text-xs">
                    <Link to="/recruiter/company">Company profile</Link>
                  </Button>
                </div>
              </div>
            ) : null}
            {turns.length > 0 ? (
              <div className="mb-2.5 flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy || !jobs.data?.length}
                    onClick={() => void submitChat(s)}
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
                void submitChat(question);
              }}
            >
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask to search jobs, shortlist, or draft outreach..."
                disabled={busy || !jobs.data?.length}
                aria-label="Recruiter agent question"
                className="h-10 flex-1 border-0 bg-transparent px-3 text-sm shadow-none focus-visible:ring-0"
              />
              <span className="hidden shrink-0 rounded-md bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground sm:inline-flex">
                Supervisor v2.4
              </span>
              <Button
                type="submit"
                size="icon"
                variant="signal"
                className="size-10 shrink-0 rounded-xl"
                disabled={busy || question.trim().length < 2 || !jobs.data?.length}
                aria-label="Send question"
                title="Send to AI Recruiter"
              >
                {busy ? <Loader2 className="animate-spin" /> : <SendHorizontal className="size-4" />}
              </Button>
            </form>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Actions run via Supervisor. Emails &amp; updates require confirmation. History is local
              to this browser only.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
