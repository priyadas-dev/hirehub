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
  /**
   * True when this ask turn includes a chat PDF/DOCX resume attachment.
   * Portfolio is never required — resume alone is enough to apply.
   */
  hasChatResumeAttachment?: boolean;
  /**
   * On Confirm: persist a chat-attached resume to the seeker's Storage + profile
   * when the profile has no resume yet. Returns the new storage path.
   */
  ensureChatResume?: () => Promise<{
    resumeStoragePath: string;
    resumeFileName: string;
  } | null>;
  /**
   * Persist name/email onto profiles when chat/auth filled blanks (JWT update).
   * Never invent values — only write what we already resolved for this apply.
   */
  persistSeekerIdentity?: (input: {
    fullName: string;
    email: string;
  }) => Promise<void>;
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
  /** Original seeker question — may include name/email when profile is incomplete. */
  question?: string | null;
  /** Recent conversation text — identity may appear in earlier turns. */
  conversationContext?: string | null;
};

/** Pull optional name/email from chat text when profile fields are blank. */
export function extractIdentityHintsFromQuestion(question: string): {
  fullName?: string;
  email?: string;
  preferAccountEmail?: boolean;
} {
  const q = question.trim();
  if (!q) return {};
  const email = q.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.trim();
  const preferAccountEmail =
    /\b(use\s+)?(my\s+)?(profile|account|login|registered)\s*(e-?mail|mail)\b/i.test(q) ||
    /\bmail\s+is\s+my\s+profile\b/i.test(q) ||
    /\b(same|existing)\s+(e-?mail|mail)\b/i.test(q);

  const namePatterns = [
    /\b(?:my\s+)?name\s*(?:is|=|:)\s*([A-Za-z][A-Za-z .'-]{1,60})/i,
    /\bi\s+am\s+([A-Za-z][A-Za-z .'-]{1,60})/i,
    /\bfull\s*name\s*(?:is|=|:)\s*([A-Za-z][A-Za-z .'-]{1,60})/i,
  ];
  let fullName: string | undefined;
  for (const re of namePatterns) {
    const m = q.match(re);
    if (m?.[1]) {
      fullName = m[1].replace(/\s+(email|mail|@).*$/i, "").trim();
      break;
    }
  }
  // Short reply that is only a person name (e.g. "Dibyo Das.")
  if (!fullName) {
    const bare = q
      .replace(/[.?!,]+$/g, "")
      .trim()
      .match(/^([A-Za-z][A-Za-z'-]+)(?:\s+[A-Za-z][A-Za-z'-]+){0,3}$/);
    if (bare?.[0] && !/^(yes|no|ok|okay|thanks|apply|job|resume|cv)$/i.test(bare[0])) {
      fullName = bare[0].trim();
    }
  }
  return {
    ...(fullName ? { fullName } : {}),
    ...(email ? { email } : {}),
    ...(preferAccountEmail ? { preferAccountEmail: true } : {}),
  };
}

/** Merge identity hints from the current question and prior conversation text. */
export function extractIdentityHintsFromConversation(
  question?: string | null,
  conversationContext?: string | null,
): ReturnType<typeof extractIdentityHintsFromQuestion> {
  const chunks = [conversationContext ?? "", question ?? ""].filter((s) => s.trim());
  const merged: ReturnType<typeof extractIdentityHintsFromQuestion> = {};
  for (const chunk of chunks) {
    // Scan line-by-line so a bare name turn is not drowned by long context.
    for (const line of chunk.split(/\n+/)) {
      const part = extractIdentityHintsFromQuestion(line.trim());
      if (part.fullName && !merged.fullName) merged.fullName = part.fullName;
      if (part.email && !merged.email) merged.email = part.email;
      if (part.preferAccountEmail) merged.preferAccountEmail = true;
    }
  }
  return merged;
}

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

/**
 * True when the seeker is confirming a pending apply (chat Confirm, not the UI button).
 * Bare "confirm"/"yes" must route to Application Agent — never Gemini inventing "submitted".
 */
export function looksLikeConfirmApplyIntent(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (
    /^\s*(y|yes|ok|okay|sure|confirm|conifrm|confrm|confirn|comfirm|confim|proceed)\s*[!.]?\s*$/i.test(
      q,
    )
  ) {
    return true;
  }
  // "please confirm" / "confirm apply" / "yes confirm" / "confirm to job <uuid>"
  if (
    /\b(confirm|conifrm|confrm|confirn|comfirm|confim)\b/i.test(q) &&
    /\b(appl(?:y|ied|ying)|job|yes|please|proceed|submit|application)\b/i.test(q)
  ) {
    return true;
  }
  if (/\b(confirm|conifrm|confrm)\b/i.test(q) && UUID_IN_TEXT_RE.test(q)) return true;
  return false;
}

/** True when the seeker is asking the Application Agent to apply (not general advice). */
export function looksLikeApplyIntent(question: string): boolean {
  const q = question.trim();
  if (looksLikeConfirmApplyIntent(q)) return true;
  // Match apply / applied / applying — noisy chat often uses past tense.
  if (
    !/\b(appl(?:y|ied|ying)|submit\s+(an?\s+)?application|send\s+(my\s+)?(resume|cv))\b/i.test(
      q,
    )
  ) {
    return false;
  }
  // Generic advice only — keep on legacy ("How do I apply in general?")
  if (
    /\bhow\b[\s\S]{0,24}\b(do|can|should)\b[\s\S]{0,24}\bappl(?:y|ied|ying)\b/i.test(q) &&
    !/\b(this|that|first|second|third|job|role|software|developer|engineer)\b/i.test(q)
  ) {
    return false;
  }
  // "apply to this job" / "now applied in the job" / "apply for that role"
  if (/\b(job|role|position|opening|this|that|it)\b/i.test(q)) return true;
  // "apply to the first job" / "apply first one"
  if (/\b(first|1st|second|2nd|third|3rd|one)\b/i.test(q)) return true;
  // "apply Software Engineer" / "apply in software developtre" / "now apply in …"
  if (
    /\bappl(?:y|ied|ying)(?:\s+to|\s+for|\s+in)?\s+(?!general\b|here\b|online\b|please\b)[A-Za-z]/i.test(
      q,
    )
  ) {
    return true;
  }
  // Banglish / short: "sudu resume ase now applied"
  if (/\b(resume|cv)\b/i.test(q) && /\bappl(?:y|ied|ying)\b/i.test(q)) return true;
  return false;
}

/** True when the seeker is asking to save/bookmark a shown job. */
export function looksLikeSaveJobIntent(question: string): boolean {
  const q = question.trim();
  // "I like the second job" / "keep this for later"
  if (
    /\bi like\b[\s\S]{0,40}\b(job|one|this|that|first|1st|second|2nd|third|3rd)\b/i.test(q) ||
    /\bkeep\b[\s\S]{0,24}\b(this|that|it|job|one|first|second|third)\b/i.test(q)
  ) {
    return true;
  }
  // Match save / saved / bookmark / bookmarked / favourite(d)
  if (!/\b(save[ds]?|bookmark(?:ed)?|favourited?|favorited?)\b/i.test(q)) {
    return false;
  }
  if (/\b(job|role|position|opening|this|that|it)\b/i.test(q)) return true;
  // "saved first one" / "save the second"
  if (/\b(first|1st|second|2nd|third|3rd|one)\b/i.test(q)) return true;
  // "save Software Engineer"
  if (/\b(save[ds]?|bookmark(?:ed)?)\b[\s\S]{0,80}\b[A-Za-z][A-Za-z0-9+.#/-]{1,}\b/i.test(q)) {
    return true;
  }
  return false;
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
      /\b(please|can you|could you|i want to|i('?d| would) like to|save|bookmark|favourite|favorite|appl(?:y|ied|ying)|submit|application|the|a|an|this|that|it|job|jobs|role|roles|position|opening|for|to|in|at|on|of|and|or|with|from|now|only|just|sudu|ase|amar|bujtesi|resume|cv|approved|full-?time|part-?time|contract)\b/gi,
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

  // "apply to the first/second job" / "save the second"
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
  const byTitle = resolveRecentJobIdByTitle(input.question, recent);
  if (byTitle) return byTitle;

  const titleTokens = tokenizeJobHint(input.question);

  // "save this one" / "apply to that job" → primary card when no competing title tokens.
  if (
    recent.length &&
    /\b(this|that|it)\s*(one|job|role|position|opening)?\b/i.test(input.question)
  ) {
    return recent[0]!.id;
  }

  // "now applied in the job" / "apply the job" with no title cue → primary card.
  // If title cues exist but are ambiguous (byTitle null), ask — don't guess first card.
  if (
    recent.length &&
    titleTokens.length === 0 &&
    /\bappl(?:y|ied|ying)\b[\s\S]{0,48}\b(the\s+)?job\b/i.test(input.question)
  ) {
    return recent[0]!.id;
  }

  return null;
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

  const resume = (await deps.loadSeekerResume?.()) ?? {};
  const fromChat = extractIdentityHintsFromConversation(
    input.question,
    input.conversationContext,
  );
  const fullName = resume.fullName?.trim() || fromChat.fullName?.trim() || "";
  // Auth email is loaded in loadSeekerResume; chat may also include an explicit address.
  const email = resume.email?.trim() || fromChat.email?.trim() || "";
  let storagePath = resume.resumeStoragePath?.trim() || null;
  let resumeFileName = resume.resumeFileName?.trim() || null;
  const resumeUrl = resume.resumeUrl?.trim() || null;
  let hasResumeFile = Boolean(storagePath || resumeUrl);
  const chatResumeReady = Boolean(deps.hasChatResumeAttachment);

  if (!input.confirm) {
    let resumeHint: string;
    if (hasResumeFile) {
      resumeHint = "Your resume on file will be attached. Portfolio is optional — resume alone is enough.";
    } else if (chatResumeReady) {
      resumeHint =
        "I see the resume you attached in chat — that is enough (no portfolio needed). Tap Confirm and I will attach it and apply.";
    } else {
      resumeHint =
        "Attach your resume here (PDF) or upload it in Profile, then tap Confirm. Portfolio is not required.";
    }
    const identityHint =
      !fullName || !email
        ? " Your profile still needs a name and email — edit your message to add them (example: name Priya Das, email you@mail.com), say “use my profile email”, or update Profile, then Confirm."
        : "";
    return {
      ok: true,
      status: "needs_confirm",
      pendingApply: { jobId, title, requiresConfirm: true },
      message: `I can apply to “${title}” for you. ${resumeHint}${identityHint} Nothing is sent until you Confirm.`,
      insertsAttempted: 0,
    };
  }

  if (!fullName || !email) {
    return {
      ok: false,
      code: "validation",
      message:
        "I still need your name and email. Edit your message to include them (example: name Priya Das, email you@mail.com), say “use my profile email”, update Profile, then Confirm again — or apply from the job page.",
      insertsAttempted: 0,
    };
  }

  // Persist chat/auth-resolved identity so the next Confirm does not fail again.
  if (
    deps.persistSeekerIdentity &&
    (!resume.fullName?.trim() || !resume.email?.trim())
  ) {
    try {
      await deps.persistSeekerIdentity({ fullName, email });
    } catch {
      // Apply can still proceed with resolved values even if profile write fails.
    }
  }

  if (!hasResumeFile && deps.ensureChatResume) {
    try {
      const ensured = await deps.ensureChatResume();
      if (ensured?.resumeStoragePath) {
        storagePath = ensured.resumeStoragePath.trim();
        resumeFileName = ensured.resumeFileName?.trim() || resumeFileName;
        hasResumeFile = true;
      }
    } catch (err) {
      return {
        ok: false,
        code: "validation",
        message:
          err instanceof Error
            ? err.message
            : "Could not save the resume from chat. Upload it in Profile, then Confirm again.",
        insertsAttempted: 0,
      };
    }
  }

  if (!hasResumeFile) {
    return {
      ok: false,
      code: "validation",
      message:
        "I still need a resume to apply. Attach a PDF in chat or upload one in Profile, then say “apply” and Confirm. Portfolio is not required.",
      insertsAttempted: 0,
    };
  }

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

  // UI Confirm does not collect a cover note; use an explicit default after Confirm only.
  const aboutYou =
    input.coverNote?.trim() ||
    `I am interested in the “${title}” role and am applying through the HireHub assistant.`;

  const result: ApplyToJobResult = await applyToJob(deps.applyClient, {
    jobId,
    seekerId,
    fullName,
    email,
    canPersistStorage: Boolean(storagePath),
    resumeStoragePath: storagePath,
    resumeFileName,
    resumeUrl: storagePath ? null : resumeUrl,
    // Portfolio is optional — never block apply when missing.
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
