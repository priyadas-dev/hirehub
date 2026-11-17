/**
 * Application agent (Phase 7+) — apply (confirm gate), save job, check application status.
 * Uses JWT clients only — never service role. Seeker id comes from auth deps, never user text.
 */

import {
  applyToJob,
  type ApplyToJobClient,
  type ApplyToJobResult,
} from "@/lib/apply-to-job";
import { saveJob, type SaveJobClient } from "@/lib/save-job";
import {
  checkSeekerApplicationStatus,
  type SeekerApplicationStatusClient,
  type SeekerApplicationStatusRow,
} from "@/lib/seeker-application-status";

export type ApplicationAgentJobRef = {
  id: string;
  title: string;
  company_name?: string | null;
};

export type ApplicationAgentDeps = {
  seekerId: string;
  applyClient: ApplyToJobClient;
  isDeadlinePassed: (job: { id: string; status: string; application_deadline?: string | null }) => boolean;
  assertResumeStoragePath?: (path: string, seekerId: string) => void;
  /** Optional: load seeker resume + identity from profile (JWT-scoped). */
  loadSeekerResume?: () => Promise<{
    fullName?: string | null;
    email?: string | null;
    resumeStoragePath?: string | null;
    resumeFileName?: string | null;
    resumeUrl?: string | null;
    portfolioUrl?: string | null;
  } | null>;
  /** Save Job tool — JWT saved_jobs client. */
  saveClient?: SaveJobClient;
  /** Check Application Status tool — JWT applications client. */
  statusClient?: SeekerApplicationStatusClient;
};

export type ApplicationAgentInput = {
  /** Target approved job id (from live citations / user selection). */
  jobId: string;
  jobTitle?: string;
  /** Must be true to insert an application row. */
  confirm: boolean;
  coverNote?: string | null;
  recentJobs?: ApplicationAgentJobRef[];
};

export type ApplicationAgentResult =
  | {
      ok: true;
      status: "needs_confirm";
      pendingApply: {
        jobId: string;
        title: string;
        requiresConfirm: true;
      };
      message: string;
      insertsAttempted: 0;
    }
  | {
      ok: true;
      status: "created" | "already_applied";
      applicationId: string;
      jobId: string;
      message: string;
      insertsAttempted: 1;
    }
  | {
      ok: false;
      code: "validation" | "unauthorized" | "unavailable" | "deadline" | "db" | "forbidden";
      message: string;
      insertsAttempted: 0;
    };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Unanchored — for scanning free-text questions. */
const UUID_IN_TEXT_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

export function looksLikeApplyIntent(question: string): boolean {
  return (
    /\b(apply|submit\s+(an?\s+)?application|send\s+(my\s+)?(resume|cv))\b/i.test(question) &&
    /\b(job|role|position|opening|this|that|it)\b/i.test(question)
  );
}

export function looksLikeSaveJobIntent(question: string): boolean {
  return (
    /\b(save|bookmark|favourite|favorite)\b/i.test(question) &&
    /\b(job|role|position|opening|this|that|it)\b/i.test(question)
  );
}

export function looksLikeCheckStatusIntent(question: string): boolean {
  return (
    /\b(application\s+status|status\s+of\s+(my\s+)?application|check\s+(my\s+)?application|track\s+(my\s+)?application|where\s+is\s+my\s+application|have\s+i\s+applied|my\s+applications?)\b/i.test(
      question,
    ) || /\b(check|what(?:'| i)?s)\b.+\bstatus\b/i.test(question)
  );
}

/** Shared prefix length for noisy titles ("enginee" ↔ "engineer", "develope" ↔ "developer"). */
function sharedPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

function tokenizeJobHint(question: string): string[] {
  return question
    .toLowerCase()
    .replace(
      /\b(please|can you|could you|i want to|i('?d| would) like to|save|bookmark|favourite|favorite|apply|submit|application|the|a|an|this|that|it|job|jobs|role|roles|position|opening|for|to|in|at|on|of|and|or|with|from|approved|full-?time|part-?time|contract)\b/gi,
      " ",
    )
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

/**
 * Resolve a recent card by noisy / partial title (never guess when two cards tie).
 */
export function resolveRecentJobIdByTitle(
  question: string,
  recentJobs: ApplicationAgentJobRef[],
): string | null {
  if (!recentJobs.length) return null;
  const tokens = tokenizeJobHint(question);
  if (!tokens.length) return null;

  const scored = recentJobs
    .map((job) => {
      const title = job.title.toLowerCase();
      const company = (job.company_name ?? "").toLowerCase();
      const titleWords = title.split(/[^a-z0-9+#]+/).filter(Boolean);
      let score = 0;
      for (const tok of tokens) {
        if (title === tok) score += 10;
        else if (title.includes(tok)) score += 6;
        else if (titleWords.some((w) => sharedPrefixLen(tok, w) >= Math.min(5, tok.length, w.length))) {
          score += 4;
        }
        if (company && company.includes(tok)) score += 2;
      }
      return { id: job.id, score };
    })
    .filter((x) => x.score >= 4)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  if (!scored.length) return null;
  if (scored.length === 1 || scored[0]!.score > scored[1]!.score) return scored[0]!.id;
  return null;
}

/** Filter recent cards to those that plausibly match the question (for clarify UI). */
export function filterRecentJobsByQuestion(
  question: string,
  recentJobs: ApplicationAgentJobRef[],
): ApplicationAgentJobRef[] {
  const tokens = tokenizeJobHint(question);
  if (!tokens.length || !recentJobs.length) return recentJobs;
  const filtered = recentJobs.filter((job) => {
    const title = job.title.toLowerCase();
    const company = (job.company_name ?? "").toLowerCase();
    const titleWords = title.split(/[^a-z0-9+#]+/).filter(Boolean);
    return tokens.some(
      (tok) =>
        title.includes(tok) ||
        company.includes(tok) ||
        titleWords.some((w) => sharedPrefixLen(tok, w) >= Math.min(5, tok.length, w.length)),
    );
  });
  return filtered.length > 0 ? filtered : recentJobs;
}

export function extractApplyJobId(input: {
  question: string;
  applyJobId?: string | null;
  recentJobs?: ApplicationAgentJobRef[];
}): string | null {
  if (input.applyJobId && UUID_RE.test(input.applyJobId.trim())) {
    return input.applyJobId.trim();
  }
  const fromQuestion = input.question.match(UUID_IN_TEXT_RE);
  if (fromQuestion?.[0]) return fromQuestion[0];

  const recent = input.recentJobs ?? [];
  if (recent.length === 1) return recent[0]!.id;

  // "apply to the first/second job"
  const ordinal = input.question.match(/\b(first|1st|second|2nd|third|3rd)\b/i);
  if (ordinal && recent.length) {
    const map: Record<string, number> = {
      first: 0,
      "1st": 0,
      second: 1,
      "2nd": 1,
      third: 2,
      "3rd": 2,
    };
    const idx = map[ordinal[1]!.toLowerCase()];
    if (idx != null && recent[idx]) return recent[idx]!.id;
  }

  // Fuzzy / noisy title match against cards already shown in this conversation.
  return resolveRecentJobIdByTitle(input.question, recent);
}

/** Same job-id resolution as apply — used for Save Job. */
export function extractSaveJobId(input: {
  question: string;
  saveJobId?: string | null;
  applyJobId?: string | null;
  recentJobs?: ApplicationAgentJobRef[];
}): string | null {
  if (input.saveJobId && UUID_RE.test(input.saveJobId.trim())) {
    return input.saveJobId.trim();
  }
  return extractApplyJobId({
    question: input.question,
    applyJobId: input.applyJobId,
    recentJobs: input.recentJobs,
  });
}

export function extractStatusApplicationId(question: string): string | null {
  const match = question.match(UUID_IN_TEXT_RE);
  return match?.[0] ?? null;
}

export type SaveJobAgentInput = {
  jobId: string;
  jobTitle?: string;
  recentJobs?: ApplicationAgentJobRef[];
};

export type SaveJobAgentResult =
  | {
      ok: true;
      status: "saved" | "already_saved";
      savedJobId: string;
      jobId: string;
      title: string;
      message: string;
    }
  | {
      ok: false;
      code: "unauthorized" | "unavailable" | "validation" | "db";
      message: string;
    };

export type CheckStatusAgentInput = {
  jobId?: string;
  applicationId?: string;
  question?: string;
  recentJobs?: ApplicationAgentJobRef[];
};

export type CheckStatusAgentResult =
  | {
      ok: true;
      applications: SeekerApplicationStatusRow[];
      message: string;
    }
  | {
      ok: false;
      code: "unauthorized" | "validation" | "db";
      message: string;
    };

/**
 * Save Job tool — authenticated seeker only; never trusts seeker id from input.
 */
export async function runSaveJobTool(
  input: SaveJobAgentInput,
  deps: Pick<ApplicationAgentDeps, "seekerId" | "saveClient">,
): Promise<SaveJobAgentResult> {
  const seekerId = deps.seekerId.trim();
  if (!seekerId) {
    return {
      ok: false,
      code: "unauthorized",
      message: "Sign in as a job seeker to save jobs.",
    };
  }
  if (!deps.saveClient) {
    return {
      ok: false,
      code: "validation",
      message: "Save Job is not available in this session.",
    };
  }

  const jobId = input.jobId.trim();
  if (!jobId || !UUID_RE.test(jobId)) {
    return {
      ok: false,
      code: "validation",
      message: "Choose an approved job (or include its id) before saving.",
    };
  }

  const result = await saveJob(deps.saveClient, { jobId, seekerId });
  if (!result.ok) return result;

  const title =
    input.jobTitle?.trim() ||
    input.recentJobs?.find((j) => j.id === jobId)?.title ||
    result.title;

  return {
    ok: true,
    status: result.status,
    savedJobId: result.savedJobId,
    jobId: result.jobId,
    title,
    message:
      result.status === "saved"
        ? `Saved “${title}” to your bookmarks.`
        : `“${title}” is already in your saved jobs.`,
  };
}

/**
 * Check Application Status — only returns rows for deps.seekerId.
 */
export async function runCheckApplicationStatusTool(
  input: CheckStatusAgentInput,
  deps: Pick<ApplicationAgentDeps, "seekerId" | "statusClient">,
): Promise<CheckStatusAgentResult> {
  const seekerId = deps.seekerId.trim();
  if (!seekerId) {
    return {
      ok: false,
      code: "unauthorized",
      message: "Sign in as a job seeker to check application status.",
    };
  }
  if (!deps.statusClient) {
    return {
      ok: false,
      code: "validation",
      message: "Application status is not available in this session.",
    };
  }

  let applicationId = input.applicationId?.trim() || undefined;
  let jobId = input.jobId?.trim() || undefined;

  if (!applicationId && !jobId && input.question) {
    const fromText = extractStatusApplicationId(input.question);
    if (fromText) applicationId = fromText;
    else {
      const fromRecent = extractApplyJobId({
        question: input.question,
        recentJobs: input.recentJobs,
      });
      if (fromRecent && /\b(this|that|job|role|position)\b/i.test(input.question)) {
        jobId = fromRecent;
      }
    }
  }

  if (applicationId && !UUID_RE.test(applicationId)) {
    return { ok: false, code: "validation", message: "That application id looks invalid." };
  }
  if (jobId && !UUID_RE.test(jobId)) {
    return { ok: false, code: "validation", message: "That job id looks invalid." };
  }

  const result = await checkSeekerApplicationStatus(deps.statusClient, {
    seekerId,
    jobId,
    applicationId,
  });
  if (!result.ok) return result;

  if (result.applications.length === 0) {
    const scoped = applicationId
      ? "I could not find that application on your account."
      : jobId
        ? "You have no application for that job yet."
        : "You have no applications yet.";
    return { ok: true, applications: [], message: scoped };
  }

  return {
    ok: true,
    applications: result.applications,
    message:
      result.applications.length === 1
        ? `Your application for “${result.applications[0]!.jobTitle}” is **${result.applications[0]!.status}**.`
        : `Here are your ${result.applications.length} applications. Details are shown below.`,
  };
}

/**
 * Application specialist. Unconfirmed calls never insert.
 */
export async function runApplicationAgent(
  input: ApplicationAgentInput,
  deps: ApplicationAgentDeps,
): Promise<ApplicationAgentResult> {
  const seekerId = deps.seekerId.trim();
  const jobId = input.jobId.trim();
  if (!seekerId) {
    return {
      ok: false,
      code: "unauthorized",
      message: "Sign in as a job seeker to apply.",
      insertsAttempted: 0,
    };
  }
  if (!jobId || !UUID_RE.test(jobId)) {
    return {
      ok: false,
      code: "validation",
      message: "Choose an approved job (or include its id) before applying.",
      insertsAttempted: 0,
    };
  }

  const title =
    input.jobTitle?.trim() ||
    input.recentJobs?.find((j) => j.id === jobId)?.title ||
    "this job";

  if (!input.confirm) {
    return {
      ok: true,
      status: "needs_confirm",
      pendingApply: { jobId, title, requiresConfirm: true },
      message: `I can apply to “${title}” for you. Confirm to submit your application — nothing is sent until you confirm.`,
      insertsAttempted: 0,
    };
  }

  const resume = (await deps.loadSeekerResume?.()) ?? {};
  const fullName = resume.fullName?.trim() || "";
  const email = resume.email?.trim() || "";
  const aboutYou = input.coverNote?.trim() || "";
  if (!fullName || !email || aboutYou.length < 10) {
    return {
      ok: false,
      code: "validation",
      message:
        "To apply here, your profile needs a name and email, and you must include an About you note (at least 10 characters). Or open the job page and use the Apply form.",
      insertsAttempted: 0,
    };
  }

  const storagePath = resume.resumeStoragePath?.trim() || null;
  if (storagePath && deps.assertResumeStoragePath) {
    try {
      deps.assertResumeStoragePath(storagePath, seekerId);
    } catch (err) {
      return {
        ok: false,
        code: "validation",
        message: err instanceof Error ? err.message : "Resume path is invalid for this seeker.",
        insertsAttempted: 0,
      };
    }
  }

  const result: ApplyToJobResult = await applyToJob(deps.applyClient, {
    jobId,
    seekerId,
    fullName,
    email,
    canPersistStorage: Boolean(storagePath),
    resumeStoragePath: storagePath,
    resumeFileName: resume.resumeFileName ?? null,
    resumeUrl: storagePath ? null : resume.resumeUrl ?? null,
    portfolioUrl: resume.portfolioUrl ?? null,
    coverNote: aboutYou,
    isDeadlinePassed: deps.isDeadlinePassed,
    assertResumeStoragePath: deps.assertResumeStoragePath,
  });

  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      message: result.message,
      insertsAttempted: 0,
    };
  }

  return {
    ok: true,
    status: result.status,
    applicationId: result.applicationId,
    jobId,
    message:
      result.status === "created"
        ? `Application submitted for “${title}”.`
        : `You already applied to “${title}”.`,
    insertsAttempted: 1,
  };
}
