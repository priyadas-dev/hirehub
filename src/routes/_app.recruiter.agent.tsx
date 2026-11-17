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
  Pencil,
  Plus,
  Search,
  SendHorizontal,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  RecruiterAgentEmpty,
  RecruiterAgentLoading,
} from "@/components/recruiter/RecruiterAgentFeedback";
import { CardSkeleton, ErrorState, PageHeader } from "@/components/feedback/States";
import { StatusBadge } from "@/components/status/StatusBadge";
import type { ApplicationStatus } from "@/components/status/status";
import { Button } from "@/components/ui/button";
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
import {
  RECRUITER_SHORTLIST_PROCESS_HELP,
  applicantDisplayName,
  detectRecruiterChatIntent,
  extractApplicantNameHint,
  extractApplicantNameHints,
  extractApplicantOrdinalRef,
  extractJobTitleHint,
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
  rankOwnedJobsByQuery,
  resolveApplicantChoiceFromRef,
  suggestJobsWithApplicants,
  type RecruiterChatTurn,
} from "@/lib/ai/recruiter-agent-ui";
import { useAuth } from "@/lib/auth";
import { fmtDate, supabase } from "@/components/dashboard/parts";
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
  const [jobSearch, setJobSearch] = useState("");
  const [applicantSearch, setApplicantSearch] = useState("");
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
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const editInputRef = useRef<HTMLTextAreaElement | null>(null);
  const persistTitleRef = useRef<string>("New conversation");

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

  const filteredJobs = useMemo(() => {
    const list = jobs.data ?? [];
    const q = jobSearch.trim().toLowerCase();
    const filtered = !q
      ? [...list]
      : list.filter(
          (j) => j.title.toLowerCase().includes(q) || j.status.toLowerCase().includes(q),
        );
    // Jobs with applicants first (demo-friendly shortlist path), then newest.
    filtered.sort((a, b) => {
      const byApps = (b.applicantCount > 0 ? 1 : 0) - (a.applicantCount > 0 ? 1 : 0);
      if (byApps !== 0) return byApps;
      return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
    });
    return filtered;
  }, [jobs.data, jobSearch]);

  const selectedJob = useMemo(
    () => jobs.data?.find((j) => j.id === jobId) ?? null,
    [jobs.data, jobId],
  );

  const applicantPool = useMemo(() => {
    if (jobId && appsForJob.data) return appsForJob.data;
    return appsAcrossOwned.data ?? [];
  }, [jobId, appsForJob.data, appsAcrossOwned.data]);

  const filteredApplicants = useMemo(() => {
    const q = applicantSearch.trim().toLowerCase();
    if (!q) return applicantPool.slice(0, jobId ? 40 : 20);
    return applicantPool
      .filter((a) => {
        const name = a.profiles?.full_name?.toLowerCase() ?? "";
        const email = a.profiles?.email?.toLowerCase() ?? "";
        const title = a.jobs?.title?.toLowerCase() ?? "";
        const status = String(a.status).toLowerCase();
        return (
          name.includes(q) || email.includes(q) || title.includes(q) || status.includes(q)
        );
      })
      .slice(0, 40);
  }, [applicantPool, applicantSearch, jobId]);

  const selectedApp = useMemo(() => {
    const fromJob = appsForJob.data?.find((a) => a.id === selectedAppId);
    if (fromJob) return fromJob;
    return appsAcrossOwned.data?.find((a) => a.id === selectedAppId) ?? null;
  }, [appsForJob.data, appsAcrossOwned.data, selectedAppId]);

  useEffect(() => {
    if (!id) return;
    setConversations(readRecruiterAgentHistory(id).conversations);
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  useEffect(() => {
    if (!id || turns.length === 0) return;
    const firstUser = turns.find((t) => t.role === "user");
    const title = firstUser
      ? titleFromRecruiterTurn(firstUser.text)
      : persistTitleRef.current;
    persistTitleRef.current = title;
    const conversation: RecruiterAgentConversation = {
      id: conversationId,
      title,
      updatedAt: new Date().toISOString(),
      turns,
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

  function startNewConversation() {
    if (busy) return;
    setConversationId(createRecruiterConversationId());
    setTurns([]);
    setQuestion("");
    setPendingShortlistAppId(null);
    setDraftSubject("");
    setDraftBody("");
    persistTitleRef.current = "New conversation";
  }

  function openConversation(conversation: RecruiterAgentConversation) {
    if (busy) return;
    setConversationId(conversation.id);
    const normalized = conversation.turns.map(normalizeRecruiterChatTurn);
    setTurns(normalized);
    setPendingShortlistAppId(
      [...normalized]
        .reverse()
        .find((t) => t.role === "assistant" && t.pendingShortlistApplicationId)
        ?.pendingShortlistApplicationId ?? null,
    );
    const lastDraft = [...normalized]
      .reverse()
      .find((t) => t.role === "assistant" && t.draft)?.draft;
    setDraftSubject(lastDraft?.subject ?? "");
    setDraftBody(lastDraft?.body ?? "");
    persistTitleRef.current = conversation.title;
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
    const store = deleteRecruiterConversation(readRecruiterAgentHistory(id), conversation.id);
    writeRecruiterAgentHistory(id, store);
    setConversations(store.conversations);
    if (conversation.id === conversationId) startNewConversation();
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
    appendTurns({
      id: newTurnId(),
      role: "assistant",
      text: `${parsed.message} Status: ${parsed.plannedStatus}.`,
      source: "supervisor",
    });
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
    appendTurns({
      id: newTurnId(),
      role: "assistant",
      text: parsed.message,
      source: "supervisor",
      draft: { subject: parsed.subject, body },
    });
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
      appendTurns({
        id: newTurnId(),
        role: "assistant",
        text: asOutreach.message,
        source: "supervisor",
        draft: { subject: asOutreach.subject, body },
      });
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
    appendTurns({
      id: newTurnId(),
      role: "assistant",
      text: formatOwnedJobsChatReply(jobs.data ?? [], {
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

    // "show software developer applicant" → resolve owned job from NL when none selected.
    if (!effectiveJobId && questionText?.trim()) {
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
    if (effectiveJobId) {
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
      list = filteredApplicants;
      appendTurns({
        id: newTurnId(),
        role: "assistant",
        text:
          "No job selected yet — showing recent applicants across jobs you own. Pick a job (or name it in chat) to narrow the list.",
        source: "local" as const,
      });
    }
    appendTurns({
      id: newTurnId(),
      role: "assistant",
      text: formatApplicantsReply(list),
      source: "local" as const,
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

    if (jobId && selectedJob) {
      await proposeRankedShortlist(text, jobId, selectedJob);
      return;
    }

    appendTurns({
      id: newTurnId(),
      role: "assistant",
      text: `I couldn’t tell which owned job you mean. Here are jobs under your account:\n${formatOwnedJobsChatReply(jobs.data ?? [])}`,
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
      const nameGuess = extractApplicantNameHint(`select ${text}`) ?? text.trim();
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
        text: `I only search jobs you own. I couldn’t match that phrase to a job or applicant. Try a job title, “show all applicants”, or “confirm <name>”.\n\nOwned jobs:\n${formatOwnedJobsChatReply(owned)}`,
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
          const ranked = rankOwnedJobsByQuery(jobs.data ?? [], text);
          if (ranked.length === 1) {
            targetJobId = ranked[0]!.job.id;
            selectJob(targetJobId);
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

  const applicantsLoading =
    (jobId && appsForJob.isLoading) || (!jobId && appsAcrossOwned.isLoading);
  const applicantsError =
    (jobId && appsForJob.isError) || (!jobId && appsAcrossOwned.isError);

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-4 lg:flex-row">
      <aside className="surface-card flex w-full shrink-0 flex-col overflow-hidden lg:min-h-[28rem] lg:w-64">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Chat history
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
              Your chats on this device appear here after the first message.
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

      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <PageHeader
          eyebrow="Recruiter"
          title="AI Recruiter Agent"
          description="Chat to search your owned jobs, shortlist applicants, and draft outreach through HireHub’s Supervisor. Ownership stays on the server — emails are never sent from this page."
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link to="/recruiter/applicants">
                <Users /> Applicants
              </Link>
            </Button>
          }
        />

        {/* Context strip */}
        <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            <Bot className="size-4 text-signal" aria-hidden />
            Context — owned jobs & applicants
          </div>

          {jobs.isLoading ? (
            <CardSkeleton rows={2} />
          ) : jobs.isError ? (
            <ErrorState onRetry={() => void jobs.refetch()} />
          ) : !jobs.data?.length ? (
            <div className="space-y-3">
              <RecruiterAgentEmpty
                title="No jobs yet"
                description="Post a job you own before using the Recruiter Agent."
              />
              <Button variant="signal" size="sm" asChild>
                <Link to="/recruiter/jobs/new">
                  <Briefcase /> Post a job
                </Link>
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="job-search">
                  Search owned jobs
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="job-search"
                    className="pl-9"
                    placeholder="Filter by title or status…"
                    value={jobSearch}
                    onChange={(e) => setJobSearch(e.target.value)}
                  />
                </div>
                <ul className="max-h-40 divide-y overflow-y-auto rounded-xl border">
                  {filteredJobs.length === 0 ? (
                    <li className="px-3 py-2 text-xs text-muted-foreground">No jobs match.</li>
                  ) : (
                    filteredJobs.map((j) => (
                      <li key={j.id}>
                        <button
                          type="button"
                          className={cn(
                            "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-signal-soft/40",
                            jobId === j.id && "bg-signal-soft/50",
                          )}
                          onClick={() => selectJob(j.id)}
                        >
                          <span className="truncate font-medium">{j.title}</span>
                          <span className="flex shrink-0 items-center gap-1.5 text-[10px] uppercase text-muted-foreground">
                            {j.applicantCount > 0 ? (
                              <span className="rounded-full bg-signal/10 px-1.5 py-0.5 font-medium normal-case tracking-normal text-signal">
                                {j.applicantCount} app{j.applicantCount === 1 ? "" : "s"}
                              </span>
                            ) : null}
                            <span>{j.status}</span>
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="app-search">
                  Search applicants {jobId ? "for this job" : "across owned jobs"}
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="app-search"
                    className="pl-9"
                    placeholder="Name, email, status, job title…"
                    value={applicantSearch}
                    onChange={(e) => setApplicantSearch(e.target.value)}
                  />
                </div>
                {applicantsLoading ? (
                  <RecruiterAgentLoading label="Loading applicants…" />
                ) : applicantsError ? (
                  <ErrorState
                    onRetry={() => {
                      void appsForJob.refetch();
                      void appsAcrossOwned.refetch();
                    }}
                  />
                ) : filteredApplicants.length === 0 ? (
                  <RecruiterAgentEmpty
                    title={jobId ? "No applicants for this job" : "No applicants found"}
                    description={
                      jobId
                        ? "When seekers apply, they will appear here for shortlisting."
                        : "Select a job or adjust search. Only applicants on jobs you own are shown."
                    }
                  />
                ) : (
                  <ul className="max-h-40 divide-y overflow-y-auto rounded-xl border">
                    {filteredApplicants.map((app) => {
                      const name = app.profiles?.full_name?.trim() || "Applicant";
                      const active = selectedAppId === app.id;
                      return (
                        <li key={app.id}>
                          <button
                            type="button"
                            className={cn(
                              "flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-signal-soft/40",
                              active && "bg-signal-soft/50",
                            )}
                            onClick={() => selectApplicant(app)}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{name}</p>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {app.jobs?.title ?? "Job"} · Applied {fmtDate(app.created_at)}
                              </p>
                            </div>
                            <StatusBadge status={app.status} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {selectedJob && (
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-xs">
                <Briefcase className="size-3" aria-hidden />
                Job: {selectedJob.title}
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-muted"
                  aria-label="Clear job"
                  onClick={() => selectJob("")}
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
            {selectedApp && (
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-xs">
                <Users className="size-3" aria-hidden />
                Applicant: {selectedApp.profiles?.full_name?.trim() || "Selected"}
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-muted"
                  aria-label="Clear applicant"
                  onClick={() => setSelectedAppId("")}
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
            {!selectedJob && !selectedApp && (
              <p className="text-xs text-muted-foreground">
                Tip: search your jobs, select an applicant, then chat to shortlist or draft outreach.
              </p>
            )}
          </div>
        </section>

        {/* Chat */}
        <section className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-signal" aria-hidden />
              Recruiter chat
            </div>
            <p className="text-[11px] text-muted-foreground">Actions run via Supervisor</p>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {turns.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Ask me to list jobs, show applicants, propose a shortlist, or draft outreach.
                  Shortlist needs your confirm; emails are never sent from this page.
                </p>
                <div className="flex flex-wrap gap-2">
                  {STARTERS.map((s) => (
                    <Button
                      key={s}
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || !jobs.data?.length}
                      onClick={() => void submitChat(s)}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t, turnIndex) => {
              const editIdx = editingTurnId
                ? turns.findIndex((x) => x.id === editingTurnId)
                : -1;
              if (editIdx >= 0 && turnIndex > editIdx) return null;

              return t.role === "user" ? (
                <div key={t.id} className="flex justify-end">
                  <div className="group relative max-w-[85%]">
                    {editingTurnId === t.id ? (
                      <div className="space-y-2 rounded-2xl rounded-tr-md border border-signal/30 bg-background px-3 py-2 shadow-sm">
                        <textarea
                          ref={editInputRef}
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          rows={3}
                          disabled={busy}
                          className="w-full resize-y rounded-md border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-signal/40"
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
                      <div className="rounded-2xl rounded-tr-md bg-signal px-4 py-2.5 text-sm text-signal-foreground">
                        {t.text}
                        <button
                          type="button"
                          className="absolute -left-9 top-1 inline-flex size-7 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-100 shadow-sm transition hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100"
                          aria-label="Edit message"
                          title="Edit message"
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
                <div key={t.id} className="space-y-2">
                  <div
                    className={cn(
                      "max-w-[90%] space-y-2 rounded-2xl rounded-tl-md border px-4 py-3 text-sm",
                      t.error
                        ? "border-destructive/20 bg-destructive/5"
                        : "bg-muted/30",
                    )}
                  >
                    <p className="whitespace-pre-wrap text-foreground">{t.text}</p>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {normalizeRecruiterChatTurn(t).source === "supervisor"
                        ? "via Supervisor"
                        : "Local · owned data"}
                    </p>
                  </div>

                  {t.applicantChoices && t.applicantChoices.length > 0 && (
                    <div className="flex max-w-xl flex-col gap-2 rounded-2xl border bg-card p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Step: select applicant
                        </p>
                        <p className="text-[11px] text-muted-foreground">Then Confirm below</p>
                      </div>
                      <div className="flex flex-col gap-2">
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
                                "rounded-xl border px-3 py-2.5 transition-colors",
                                active
                                  ? "border-signal/40 bg-signal/10"
                                  : "hover:bg-muted/40",
                              )}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{choice.label}</p>
                                  <p className="truncate text-[11px] text-muted-foreground">
                                    {choice.meta}
                                    {choice.email ? ` · ${choice.email}` : ""}
                                  </p>
                                </div>
                                {active && (
                                  <span className="shrink-0 rounded-full bg-signal/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-signal">
                                    Selected
                                  </span>
                                )}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={active ? "signal" : "outline"}
                                  disabled={busy || confirmShortlist.isPending}
                                  onClick={() =>
                                    void selectAndProposeShortlist(choice.applicationId)
                                  }
                                >
                                  {active ? "Selected" : "Select"}
                                </Button>
                                {hasResume ? (
                                  <ResumeOpenLink
                                    storagePath={choice.resumeStoragePath}
                                    legacyUrl={choice.resumeUrl}
                                    fileName={choice.resumeFileName || "View resume"}
                                  />
                                ) : (
                                  <span className="inline-flex items-center text-[11px] text-muted-foreground">
                                    No resume on file
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {t.draft && (
                    <div className="max-w-xl space-y-2 rounded-2xl border bg-card p-4">
                      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                        <Mail className="size-3.5" aria-hidden />
                        Outreach draft (not sent)
                      </div>
                      <p className="text-sm font-medium">{t.draft.subject}</p>
                      <p className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                        {t.draft.body.slice(0, 400)}
                        {t.draft.body.length > 400 ? "…" : ""}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}

            {busy && <RecruiterAgentLoading label="Running via Supervisor…" />}
            <div ref={bottomRef} />
          </div>

          {pendingShortlistAppId && (
            <div className="space-y-2 border-t border-signal/20 bg-signal/5 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-signal">
                Step: confirm shortlist
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  Proposed:{" "}
                  <span className="font-medium">
                    {selectedApp
                      ? applicantDisplayName({
                          full_name: selectedApp.profiles?.full_name,
                          email: selectedApp.profiles?.email,
                        })
                      : "Selected applicant"}
                  </span>
                  . Status changes only after Confirm.
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
                    onClick={() => setPendingShortlistAppId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
              {(selectedApp?.resume_storage_path || selectedApp?.resume_url) && (
                <ResumeOpenLink
                  storagePath={selectedApp.resume_storage_path}
                  legacyUrl={selectedApp.resume_url}
                  fileName={selectedApp.resume_file_name || "View resume"}
                />
              )}
            </div>
          )}

          <form
            className="flex items-end gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submitChat(question);
            }}
          >
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask to search jobs, shortlist, or draft outreach…"
              disabled={busy || !jobs.data?.length}
              aria-label="Recruiter agent question"
            />
            <Button
              type="submit"
              size="icon"
              variant="signal"
              disabled={busy || question.trim().length < 2 || !jobs.data?.length}
              aria-label="Send question"
            >
              {busy ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
            </Button>
          </form>
        </section>

        {/* Persistent draft editor */}
        {(draftSubject || draftBody) && (
          <section className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm">
            <div className="space-y-1">
              <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                <Mail className="size-4 text-signal" aria-hidden />
                Outreach draft editor
              </h2>
              <p className="text-xs text-muted-foreground">
                Draft only — <code className="text-[11px]">confirmSend: false</code>. Nothing is
                emailed from this page.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="outreach-subject">
                Subject
              </label>
              <Input
                id="outreach-subject"
                value={draftSubject}
                onChange={(e) => setDraftSubject(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="outreach-body">
                Body (editable)
              </label>
              <Textarea
                id="outreach-body"
                rows={8}
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
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
              {jobId && (
                <Button
                  type="button"
                  size="sm"
                  variant="signal"
                  disabled={busy}
                  onClick={() => void submitChat("Draft outreach for this job")}
                >
                  Redraft via Supervisor
                </Button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
