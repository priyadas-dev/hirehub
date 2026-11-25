/**
 * Helpers for the Recruiter Agent UI — normalize askRecruiterAgent responses for display.
 * No network calls; safe for unit tests.
 */

export type RecruiterAgentUiShortlistSuccess = {
  kind: "shortlist";
  applicationId: string;
  plannedStatus: string;
  message: string;
  needsConfirm: boolean;
};

export type RecruiterAgentUiOutreachSuccess = {
  kind: "outreach";
  message: string;
  subject: string;
  htmlBody: string;
  campaignName?: string;
};

export type RecruiterAgentUiFailure = {
  kind: "error";
  code: string;
  message: string;
};

export function parseShortlistAgentResult(result: unknown): RecruiterAgentUiShortlistSuccess | RecruiterAgentUiFailure {
  if (!result || typeof result !== "object") {
    return { kind: "error", code: "unknown", message: "Unexpected shortlist response." };
  }
  const r = result as Record<string, unknown>;
  if (r.ok === false) {
    return {
      kind: "error",
      code: typeof r.code === "string" ? r.code : "unknown",
      message: typeof r.message === "string" ? r.message : "Shortlist failed.",
    };
  }
  if (r.ok === true && r.status === "needs_confirm") {
    return {
      kind: "shortlist",
      applicationId: String(r.applicationId ?? ""),
      plannedStatus: String(r.plannedStatus ?? "shortlisted"),
      message: typeof r.message === "string" ? r.message : "Confirm to shortlist.",
      needsConfirm: true,
    };
  }
  if (r.ok === true && (r.status === "updated" || r.status === "authorized")) {
    return {
      kind: "shortlist",
      applicationId: String(r.applicationId ?? ""),
      plannedStatus: String(r.plannedStatus ?? "shortlisted"),
      message: typeof r.message === "string" ? r.message : "Application updated.",
      needsConfirm: false,
    };
  }
  return {
    kind: "error",
    code: "unknown",
    message: typeof r.message === "string" ? r.message : "Unexpected shortlist response.",
  };
}

export function parseOutreachAgentResult(result: unknown): RecruiterAgentUiOutreachSuccess | RecruiterAgentUiFailure {
  if (!result || typeof result !== "object") {
    return { kind: "error", code: "unknown", message: "Unexpected outreach response." };
  }
  const r = result as Record<string, unknown>;
  if (r.ok === false) {
    return {
      kind: "error",
      code: typeof r.code === "string" ? r.code : "unknown",
      message: typeof r.message === "string" ? r.message : "Outreach draft failed.",
    };
  }

  const campaign = r.campaign as Record<string, unknown> | undefined;
  const preview = r.preview as Record<string, unknown> | undefined;
  const subject =
    (typeof preview?.subject === "string" && preview.subject) ||
    (typeof campaign?.subject === "string" && campaign.subject) ||
    "";
  const htmlBody =
    (typeof preview?.html === "string" && preview.html) ||
    (typeof campaign?.htmlBody === "string" && campaign.htmlBody) ||
    "";

  if (r.ok === true && (subject || htmlBody)) {
    return {
      kind: "outreach",
      message: typeof r.message === "string" ? r.message : "Draft ready.",
      subject,
      htmlBody,
      campaignName: typeof campaign?.name === "string" ? campaign.name : undefined,
    };
  }

  return {
    kind: "error",
    code: "unknown",
    message: typeof r.message === "string" ? r.message : "Outreach draft had no content.",
  };
}

/** Strip simple HTML tags for a plain editable draft body. */
export function htmlToEditablePlain(html: string): string {
  return html
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** In-chat selectable applicant for shortlist propose/confirm. */
export type RecruiterApplicantChoice = {
  applicationId: string;
  label: string;
  meta?: string;
  email?: string | null;
  status?: string;
  score?: number;
  resumeStoragePath?: string | null;
  resumeUrl?: string | null;
  resumeFileName?: string | null;
};

export const RECRUITER_SHORTLIST_PROCESS_HELP = `Here’s how shortlisting works on this page (via Supervisor):

1. I only search jobs you own (JWT \`recruiter_id\`).
2. I rank applicants using recruiter-visible signals: profile name/email, cover note, and whether a resume is on file (I don’t parse PDF bytes).
3. You select an applicant and can open View resume.
4. I propose shortlist — status does not change yet.
5. You click Confirm shortlist — then the status updates.
6. Outreach is draft-only here; nothing is emailed from this page.

Try: “shortlist from Software Developer”, “show applicants for this job”, or “propose shortlist for the selected applicant”.`;

/** Where an assistant reply came from — honest provenance for the chat badge. */
export type RecruiterAssistantSource = "supervisor" | "local";

/** Chat transcript turn for the Recruiter Agent UI. */
export type RecruiterChatTurn =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      text: string;
      /** Server Supervisor (`askRecruiterAgent`) vs client-only helpers. */
      source: RecruiterAssistantSource;
      /**
       * Legacy localStorage field. Prefer `source`. When present and true without
       * `source`, treat as supervisor.
       */
      viaSupervisor?: boolean;
      pendingShortlistApplicationId?: string;
      /** Clickable applicants shown under the assistant message. */
      applicantChoices?: RecruiterApplicantChoice[];
      draft?: { subject: string; body: string };
      error?: boolean;
    };

/** Normalize history turns that may still use `viaSupervisor: true` only. */
export function normalizeRecruiterChatTurn(turn: RecruiterChatTurn): RecruiterChatTurn {
  if (turn.role !== "assistant") return turn;
  if (turn.source === "supervisor" || turn.source === "local") return turn;
  const legacy = turn as { viaSupervisor?: boolean };
  return {
    ...turn,
    source: legacy.viaSupervisor === false ? "local" : "supervisor",
  };
}

/** Best-effort message extraction from supervised / legacy Supervisor replies. */
export function parseSupervisedAgentMessage(result: unknown): string {
  if (!result || typeof result !== "object") return "Unexpected agent response.";
  const r = result as Record<string, unknown>;
  if (typeof r.message === "string" && r.message.trim()) return r.message.trim();
  if (typeof r.answer === "string" && r.answer.trim()) return r.answer.trim();
  if (r.ok === false) {
    return typeof r.message === "string" ? r.message : "Agent request failed.";
  }
  return "Done via Supervisor.";
}

export type RecruiterChatIntent =
  | "help"
  | "shortlist"
  | "confirm_shortlist"
  | "draft_outreach"
  | "list_jobs"
  | "list_applicants"
  | "open_resume"
  | "browse"
  | "supervised";

/**
 * Detect local intents so the UI can call structured shortlist/draft actions
 * when job/applicant context ids are already selected (smoother than UUID-only NL).
 */
export function detectRecruiterChatIntent(question: string): RecruiterChatIntent {
  const q = question.trim();
  // Process / how-to questions must win over shortlist keyword matching.
  if (isProcessHelpQuestion(q)) return "help";
  // "open jia resume" before list_applicants so "show … resume" is not treated as a list ask.
  if (isOpenResumeQuestion(q)) return "open_resume";
  // "List my jobs with applicants" must hit list_jobs before list_applicants.
  if (isListJobsWithApplicantsQuestion(q) || isListOwnedJobsQuestion(q)) return "list_jobs";
  if (isListApplicantsQuestion(q)) return "list_applicants";
  // "conifrm rajon" / bare "confirm" must not fall through to owned-job dump.
  if (isConfirmShortlistQuestion(q)) return "confirm_shortlist";
  // Offer/outreach before shortlist so "make an offer for this candidate" is not ordinal-shortlist.
  if (isOutreachDraftishQuestion(q)) return "draft_outreach";
  if (isShortlistishQuestion(q)) return "shortlist";
  // Skills / experience / resume / compare → server supervised Q&A (JWT ownership enforced).
  if (isApplicantContextQuestion(q)) return "supervised";
  // Noisy / incomplete: any leftover tokens → browse owned jobs + applicants locally.
  if (extractSearchTokens(q).length > 0) return "browse";
  return "supervised";
}

/** "open jia resume", "view Priya das resume", "show the resume for Alex". */
export function isOpenResumeQuestion(question: string): boolean {
  const q = question.trim();
  if (!/\b(resume|cv|curriculum\s+vitae)\b/i.test(q)) return false;
  // Summarize / skills questions about a resume stay supervised — not open.
  if (/\b(summarize|summary|skill|experience|mention|contain|parse|extract)\b/i.test(q)) {
    return false;
  }
  return /\b(open|view|show|display|see|get|pull\s+up)\b/i.test(q);
}

/**
 * Person name from open/view resume phrasing.
 * "open Priya das resume" → "Priya das"; "show resume for Jia" → "Jia".
 */
export function extractResumeOpenNameHint(question: string): string | null {
  const q = question.trim();
  const patterns = [
    /\b(?:open|view|show|display|see|get|pull\s+up)\s+([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+){0,2})\s+(?:['’]?s\s+)?(?:resume|cv|curriculum\s+vitae)\b/i,
    /\b(?:open|view|show|display|see|get|pull\s+up)\s+(?:the\s+)?(?:resume|cv|curriculum\s+vitae)\s+(?:for|of|from)\s+([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+){0,2})\b/i,
    /\b(?:resume|cv|curriculum\s+vitae)\s+(?:for|of)\s+([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+){0,2})\b/i,
  ];
  for (const re of patterns) {
    const m = q.match(re);
    const raw = m?.[1]?.trim();
    if (!raw) continue;
    if (STOPWORDS.has(raw.toLowerCase())) continue;
    if (
      /^(the|this|that|my|his|her|their|an|a|applicant|candidate|selected|resume|cv)$/i.test(raw)
    ) {
      continue;
    }
    return raw;
  }
  return null;
}

/** Route context-aware applicant questions through Supervisor (not local browse). */
export function isApplicantContextQuestion(question: string): boolean {
  const q = question.trim();
  if (/\b(resume|cv)\b/i.test(q)) return true;
  if (/\b(compare|versus|vs\.?)\b/i.test(q) && /\b(applicant|candidate|shortlist)/i.test(q)) {
    return true;
  }
  if (
    /\b(skill|skills|experience|years?|summarize|summary|machine\s+learning|react|node\.?js)\b/i.test(
      q,
    ) &&
    /\b(applicant|candidate|they|them|this\s+one|selected|resume|cv)\b/i.test(q)
  ) {
    return true;
  }
  if (/\b(does|do)\s+(this|the|my)\s+(applicant|candidate)\b/i.test(q)) return true;
  if (/\bfind\s+applicants?\b[\s\S]{0,40}\b(experience|skill|year)/i.test(q)) return true;
  return false;
}

/** "how do you shortlist?", "which process do you follow…", etc. */
export function isProcessHelpQuestion(question: string): boolean {
  const q = question.trim();
  if (
    /\b(how|what|explain|describe|walk\s*me\s*through)\b[\s\S]{0,80}\b(short[\s-]?list|confirm|supervisor|process)\b/i.test(
      q,
    )
  ) {
    return true;
  }
  if (/\b(which|what)\s+process\b/i.test(q)) return true;
  if (/\bprocess\b[\s\S]{0,48}\b(short[\s-]?list|follow|use)\b/i.test(q)) return true;
  if (
    /\b(how\s+does|how\s+do\s+(you|this|it)|how\s+is)\b/i.test(q) &&
    /\b(work|short[\s-]?list|agent|confirm)\b/i.test(q)
  ) {
    return true;
  }
  return false;
}

/** shortlist / shortliste / shortlisted / shortlis / shorlist / shortlst */
const SHORTLIST_WORD_RE =
  /\b(?:short[\s-]?(?:list(?:ed|ing|e)?|lis|lst|lsit)|shorlist|shortliset)\b/i;

/** confirm / conifrm / confrm — chat confirmation of a shortlist proposal */
const CONFIRM_WORD_RE = /\b(confirm|conifrm|confrm|confirn|comfirm|confim)\b/i;

/**
 * "confirm", "conifrm rajon", "yes", "ok" — execute or retarget pending shortlist.
 * Must win over browse so typos do not dump the owned-jobs list again.
 */
export function isConfirmShortlistQuestion(question: string): boolean {
  const q = question.trim();
  if (!q || isProcessHelpQuestion(q)) return false;
  if (/^\s*(y|yes|ok|okay|sure)\s*[!.]?\s*$/i.test(q)) return true;
  return CONFIRM_WORD_RE.test(q);
}

/**
 * "show applicants who are not shortlisted" / "only applied" — list/filter, not shortlist action.
 */
export function isApplicantStatusFilterQuestion(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (
    /\b(not|non|never|aren't|arent|without|except|excluding)\b[\s\S]{0,32}\bshort[\s-]?(?:list(?:ed|ing|e)?|lis)\b/i.test(
      q,
    )
  ) {
    return true;
  }
  if (
    /\b(who|that|which)\s+are\s+not\b[\s\S]{0,24}\bshort[\s-]?(?:list(?:ed|ing|e)?|lis)\b/i.test(q)
  ) {
    return true;
  }
  if (/\b(only|just)\s+(applied|shortlisted|rejected|interview|hired)\b/i.test(q)) return true;
  if (
    /\b(list|show|see|display|find)\b[\s\S]{0,48}\b(only\s+)?(applied|pending)\b[\s\S]{0,24}\b(applicant|cand+idate)s?\b/i.test(
      q,
    )
  ) {
    return true;
  }
  return false;
}

export type ApplicantStatusFilter =
  | { kind: "exclude"; statuses: string[] }
  | { kind: "include"; statuses: string[] };

/** Parse NL status filters for applicant lists. */
export function extractApplicantStatusFilter(question: string): ApplicantStatusFilter | null {
  const q = question.trim();
  if (!q) return null;
  if (
    /\b(not|non|never|aren't|arent|without|except|excluding)\b[\s\S]{0,32}\bshort[\s-]?(?:list(?:ed|ing|e)?|lis)\b/i.test(
      q,
    ) ||
    /\b(who|that|which)\s+are\s+not\b[\s\S]{0,24}\bshort[\s-]?(?:list(?:ed|ing|e)?|lis)\b/i.test(q)
  ) {
    return { kind: "exclude", statuses: ["shortlisted"] };
  }
  if (/\b(only|just)\s+applied\b/i.test(q) || /\bpending\b[\s\S]{0,24}\b(applicant|cand+idate)s?\b/i.test(q)) {
    return { kind: "include", statuses: ["applied"] };
  }
  if (/\b(only|just)\s+short[\s-]?(?:list(?:ed)?|lis)\b/i.test(q)) {
    return { kind: "include", statuses: ["shortlisted"] };
  }
  if (/\b(only|just)\s+rejected\b/i.test(q)) return { kind: "include", statuses: ["rejected"] };
  if (/\b(only|just)\s+interview\b/i.test(q)) return { kind: "include", statuses: ["interview"] };
  if (/\b(only|just)\s+hired\b/i.test(q)) return { kind: "include", statuses: ["hired"] };
  return null;
}

export function applyApplicantStatusFilter<T extends { status: string }>(
  applicants: T[],
  filter: ApplicantStatusFilter | null | undefined,
): T[] {
  if (!filter) return applicants;
  const wanted = new Set(filter.statuses.map((s) => s.toLowerCase()));
  if (filter.kind === "include") {
    return applicants.filter((a) => wanted.has(String(a.status).toLowerCase()));
  }
  return applicants.filter((a) => !wanted.has(String(a.status).toLowerCase()));
}

/** "select priya" / "pick rajon" — retarget shortlist by name (not browse → owned-jobs dump). */
export function isSelectApplicantByNameQuestion(question: string): boolean {
  const q = question.trim();
  if (!q || isProcessHelpQuestion(q)) return false;
  if (/\bselect\s+(?:the\s+)?job\b/i.test(q)) return false;
  if (!/\b(select|pick|choose)\b/i.test(q)) return false;
  return extractApplicantNameHints(q).length > 0;
}

export function isShortlistishQuestion(question: string): boolean {
  const q = question.trim();
  if (isProcessHelpQuestion(q)) return false;
  if (isConfirmShortlistQuestion(q)) return false;
  if (isOfferDraftishQuestion(q)) return false;
  // Status filters like "not shortlisted" are list asks, not shortlist actions.
  if (isApplicantStatusFilterQuestion(q)) return false;
  // "select priya" must shortlist-route, not fall through to browse.
  if (isSelectApplicantByNameQuestion(q)) return true;
  // Accept "shortlist", "short list", "short-list", typos (shortlis), and common candidate typos.
  return (
    SHORTLIST_WORD_RE.test(q) ||
    /\b(mark\s+as\s+short[\s-]?(?:list(?:e)?|lis)|propose\s+short[\s-]?(?:list(?:e)?|lis))\b/i.test(
      q,
    ) ||
    /\bmove\b[\s\S]{0,48}\b(?:to\s+)?short[\s-]?(?:list(?:ed|ing|e)?|lis)\b/i.test(q) ||
    /\bselect\b[\s\S]{0,40}\b(?:the\s+)?(?:best|top)\b[\s\S]{0,40}\b(applicant|cand+idate)s?\b/i.test(
      q,
    ) ||
    /\b(best|top|strong(?:est)?|good)\b[\s\S]{0,40}\b(applicants?|cand+idates?|resumes?|profiles?)\b/i.test(
      q,
    ) ||
    /\b(who|which)\b[\s\S]{0,40}\b(hire|interview|cand+idates?|applicants?)\b/i.test(q) ||
    /\b(match|rank|recommend)\b[\s\S]{0,40}\b(applicants?|cand+idates?|resumes?|profiles?)\b/i.test(
      q,
    ) ||
    /\bfind\b[\s\S]{0,40}\b(applicants?|cand+idates?|someone|person)\b/i.test(q) ||
    /\bwhat\s+about\b[\s\S]{0,24}\b(first|second|third|1st|2nd|3rd|#?\d+|this|that|him|her)\b/i.test(
      q,
    ) ||
    extractApplicantOrdinalRef(q) != null
  );
}

/** Offer letter / offer draft (never implies auto-send). */
export function isOfferDraftishQuestion(question: string): boolean {
  const q = question.trim();
  return (
    /\boffer\s+(letter|draft|email|mail)\b/i.test(q) ||
    /\b(?:draft|write|prepare|create|make|compose|give)\b[\s\S]{0,24}\boffer\b/i.test(q) ||
    /\bmake\s+(an?\s+)?offer\b/i.test(q)
  );
}

/** draft outreach / offer letter / give a draft ouitreach / write email */
export function isOutreachDraftishQuestion(question: string): boolean {
  const q = question.trim();
  if (isOfferDraftishQuestion(q)) return true;
  const wantsDraft = /\b(draft|write|prepare|create|give|make|compose)\b/i.test(q);
  // outreach, ouitreach, outrech, out-reach, email, campaign
  const wantsOutreach =
    /\b(outreach|ouitreach|outrech|out[\s-]?reach|email|campaign|mail)\b/i.test(q) ||
    /\bou[it]{0,2}r[ea]{0,2}ch\b/i.test(q);
  return wantsDraft && wantsOutreach;
}

/** "second candidate", "this applicant", "him", "the 3rd one" */
export type ApplicantOrdinalRef =
  | { kind: "index"; index: number }
  | { kind: "pronoun" };

const ORDINAL_WORD_TO_INDEX: Record<string, number> = {
  first: 0,
  "1st": 0,
  second: 1,
  "2nd": 1,
  third: 2,
  "3rd": 2,
  fourth: 3,
  "4th": 3,
  fifth: 4,
  "5th": 4,
};

export function extractApplicantOrdinalRef(question: string): ApplicantOrdinalRef | null {
  const q = question.trim();
  if (!q) return null;
  if (
    /\b(?:this|that|the\s+selected|selected)\s+(?:candidate|applicant|one|person)\b/i.test(q) ||
    /\b(?:him|her)\b/i.test(q) ||
    /\b(?:for|about)\s+(?:this|that|him|her|the\s+selected|selected)\b/i.test(q)
  ) {
    return { kind: "pronoun" };
  }
  const word = q.match(
    /\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th)\b(?:\s+(?:candidate|applicant|one|person))?\b/i,
  );
  if (word?.[1]) {
    const idx = ORDINAL_WORD_TO_INDEX[word[1].toLowerCase()];
    if (idx != null) return { kind: "index", index: idx };
  }
  const num = q.match(/\b(?:#|no\.?\s*)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:candidate|applicant|one)\b/i);
  if (num?.[1]) {
    const n = Number(num[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 20) return { kind: "index", index: n - 1 };
  }
  return null;
}

/** "best three", "top 3", "select the best 3 applicants" */
export function extractTopNApplicants(question: string): number | null {
  const q = question.trim().toLowerCase();
  const words: Record<string, number> = {
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
  };
  const m1 = q.match(/\b(?:best|top)\s+(\d+|two|three|four|five|six|seven|eight)\b/);
  if (m1?.[1]) {
    const n = words[m1[1]] ?? Number(m1[1]);
    if (Number.isFinite(n) && n >= 2 && n <= 8) return n;
  }
  const m2 = q.match(
    /\b(\d+|two|three|four|five|six|seven|eight)\s+(?:best\s+|top\s+)?(?:applicant|cand+idate)s?\b/,
  );
  if (m2?.[1]) {
    const n = words[m2[1]] ?? Number(m2[1]);
    if (Number.isFinite(n) && n >= 2 && n <= 8) return n;
  }
  return null;
}

/** "2 years of experience", "3+ yrs" */
export function extractMinYearsExperience(question: string): number | null {
  const m = question
    .trim()
    .match(/\b(\d+)\s*\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+experience)?\b/i);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 40 ? n : null;
}

/** Resolve ordinal/pronoun against recent ranked choices or sticky selection. */
export function resolveApplicantChoiceFromRef(
  choices: RecruiterApplicantChoice[],
  ref: ApplicantOrdinalRef,
  fallbackApplicationId?: string | null,
): RecruiterApplicantChoice | null {
  if (ref.kind === "index") {
    return choices[ref.index] ?? null;
  }
  if (fallbackApplicationId) {
    const hit = choices.find((c) => c.applicationId === fallbackApplicationId);
    if (hit) return hit;
    return {
      applicationId: fallbackApplicationId,
      label: "Selected applicant",
    };
  }
  return choices[0] ?? null;
}

/**
 * Resolve "this job" / no explicit title when the recruiter has an unambiguous owned job
 * (only one job, or only one job that already has applicants).
 */
export function inferOwnedJobIdFromContext(
  owned: Array<{ id: string; applicantCount?: number }>,
  options?: { currentJobId?: string | null; question?: string },
): string | null {
  if (options?.currentJobId) return options.currentJobId;
  if (owned.length === 0) return null;
  if (owned.length === 1) return owned[0]!.id;

  const q = options?.question?.trim() ?? "";
  const refersThisJob =
    /\b(this|that|the)\s+job\b/i.test(q) ||
    /\bapplicants?\s+for\s+this\b/i.test(q) ||
    /\bfor\s+this\s+job\b/i.test(q) ||
    /\bdraft\s+outreach\s+for\s+this\b/i.test(q);

  const withApps = owned.filter((j) => (j.applicantCount ?? 0) > 0);
  if (withApps.length === 1) return withApps[0]!.id;

  if (refersThisJob && withApps.length > 1) {
    const sorted = [...withApps].sort(
      (a, b) => (b.applicantCount ?? 0) - (a.applicantCount ?? 0),
    );
    const top = sorted[0]!;
    const second = sorted[1];
    if ((top.applicantCount ?? 0) > (second?.applicantCount ?? 0)) return top.id;
  }

  return null;
}

export function applicantDisplayName(input: {
  full_name?: string | null;
  email?: string | null;
}): string {
  const name = input.full_name?.trim();
  if (name) return name;
  const email = input.email?.trim();
  if (email) return email;
  return "Applicant";
}

/**
 * Starter / NL: "List my jobs with applicants" — jobs list enriched with counts.
 * Must win over pure applicant-list matching.
 */
export function isListJobsWithApplicantsQuestion(question: string): boolean {
  const q = question.trim();
  return (
    /\b(list|show|see|display)\b[\s\S]{0,48}\b(my\s+)?(own\s+)?jobs?\b[\s\S]{0,24}\bapplicants?\b/i.test(
      q,
    ) ||
    /\b(my\s+)?(own\s+)?jobs?\b[\s\S]{0,16}\bwith\b[\s\S]{0,16}\bapplicants?\b/i.test(q)
  );
}

/** "show my jobs", "list owned jobs", "are these my own jobs?" */
export function isListOwnedJobsQuestion(question: string): boolean {
  const q = question.trim();
  if (isListJobsWithApplicantsQuestion(q)) return true;
  // Pure applicant asks are not job-list asks (unless "jobs with applicants" above).
  if (/\bapplicant/i.test(q)) return false;
  if (/\b(list|show|see|display)\b[\s\S]{0,40}\b(my\s+)?(own\s+)?jobs?\b/i.test(q)) return true;
  if (/\b(my\s+own\s+jobs?|owned\s+jobs?|jobs?\s+i\s+own)\b/i.test(q)) return true;
  if (/\b(is|are)\b[\s\S]{0,24}\b(my\s+)?(own\s+)?jobs?\b/i.test(q)) return true;
  return false;
}

export function isListApplicantsQuestion(question: string): boolean {
  const q = question.trim();
  // Jobs+applicants starter is handled as list_jobs.
  if (isListJobsWithApplicantsQuestion(q)) return false;
  // "show applicants who are not shortlisted" / "only applied candidates"
  if (isApplicantStatusFilterQuestion(q)) {
    return (
      /\b(list|show|see|display|find)\b/i.test(q) ||
      /\b(applicant|cand+idate)s?\b/i.test(q) ||
      /\b(only|just)\s+(applied|shortlisted|rejected|interview|hired)\b/i.test(q)
    );
  }
  // Ranking / shortlist *action* phrasing must not become a plain list dump.
  if (/\b(best|top|rank|recommend)\b/i.test(q)) return false;
  if (/\bmove\b[\s\S]{0,24}\bshort/i.test(q)) return false;
  if (SHORTLIST_WORD_RE.test(q) && !/\b(not|non|aren't|arent|without)\b/i.test(q)) {
    return false;
  }
  return (
    /\b(list|show|see|display)\b[\s\S]{0,40}\bapplicants?\b/i.test(q) ||
    /\b(list|show|see|display)\b[\s\S]{0,40}\b(cand+idate|engineer|developer|seeker)s?\b/i.test(
      q,
    ) ||
    /\bapplicants?\s+for\s+(this\s+)?job\b/i.test(q)
  );
}

export type OwnedJobForReply = {
  title: string;
  status: string;
  applicantCount?: number;
};

/** Format owned jobs for chat; optionally include applicant counts. */
export function formatOwnedJobsReply(
  list: OwnedJobForReply[],
  options?: { includeApplicantCounts?: boolean; plain?: boolean },
): string {
  if (list.length === 0) return "You have no owned jobs yet. Post a job first.";
  const withCounts = Boolean(options?.includeApplicantCounts);
  const lines = list
    .slice(0, 20)
    .map((j, i) => {
      const base = `${i + 1}. ${j.title} (${j.status})`;
      if (!withCounts) return base;
      const n = j.applicantCount ?? 0;
      return `${base} — ${n} applicant${n === 1 ? "" : "s"}`;
    })
    .join("\n");
  // Plain list for error / clarify fallbacks — avoid "Yes — these are jobs you own…" spam.
  if (options?.plain) return lines;
  return withCounts
    ? `Yes — these are jobs you own (JWT recruiter_id), with applicant counts:\n${lines}\n\nSelect a job above or say e.g. “shortlist from AI engineers”.`
    : `Yes — these are jobs you own (JWT recruiter_id):\n${lines}\n\nSelect a job above or say e.g. “shortlist from AI engineers”.`;
}

/** Suggest owned jobs that already have applicants (empty shortlist guidance). */
export function suggestJobsWithApplicants(
  list: Array<{ title: string; applicantCount?: number }>,
  limit = 2,
): string {
  const withApps = list.filter((j) => (j.applicantCount ?? 0) > 0).slice(0, limit);
  if (withApps.length === 0) {
    return "None of your owned jobs have applicants yet.";
  }
  const names = withApps.map((j) => `“${j.title}”`).join(" or ");
  return `Try selecting ${names} (has applicants), then propose shortlist again.`;
}

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "for",
  "from",
  "on",
  "in",
  "of",
  "is",
  "are",
  "was",
  "were",
  "be",
  "this",
  "that",
  "these",
  "those",
  "my",
  "me",
  "i",
  "you",
  "we",
  "they",
  "it",
  "with",
  "about",
  "please",
  "can",
  "could",
  "would",
  "should",
  "just",
  "also",
  "any",
  "some",
  "one",
  "job",
  "jobs",
  "own",
  "owned",
  "applicant",
  "applicants",
  "application",
  "candidate",
  "candidates",
  "shortlist",
  "shortlis",
  "shorlist",
  "shortlst",
  "propose",
  "draft",
  "outreach",
  "ouitreach",
  "outrech",
  "email",
  "campaign",
  "give",
  "make",
  "compose",
  "show",
  "list",
  "find",
  "get",
  "need",
  "want",
  "help",
  "who",
  "which",
  "what",
  "how",
  "best",
  "top",
  "good",
  "strong",
  "match",
  "rank",
  "recommend",
  "pick",
  "select",
  "based",
  "resume",
  "profile",
  "skills",
  "someone",
  "person",
  "hire",
  "interview",
  "confirm",
  "conifrm",
  "confrm",
  "confirn",
  "comfirm",
  "confim",
  "yes",
  "okay",
  "sure",
  "offer",
  "letter",
  "move",
  "him",
  "her",
  "them",
  "years",
  "year",
  "yrs",
  "experience",
  "exp",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
]);

/** Tokenize noisy recruiter questions into searchable keywords. */
export function extractSearchTokens(question: string): string[] {
  const raw = question
    .toLowerCase()
    .replace(/[^a-z0-9+\s.#-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return [...new Set(raw)];
}

/** Pull a free-text job title hint after shortlist/from/for/job phrases. */
export function extractJobTitleHint(question: string): string | null {
  const q = question.trim();
  const patterns = [
    /\bshort[\s-]?(?:list(?:ed|ing|e)?|lis|lst|lsit)\s+(?:cand+iate[s]?|applicant[s]?|candidate[s]?)?\s*(?:from|for|on)\s+(?:the\s+)?(.+?)(?:\s*[?.!]|$)/i,
    /\b(?:from|for|on)\s+(?:the\s+)?job\s+(.+?)(?:\s*[?.!]|$)/i,
    /\bpick\s+(?:the\s+)?job\s+(.+?)(?:\s*[?.!]|$)/i,
    /\bselect\s+(?:the\s+)?job\s+(.+?)(?:\s*[?.!]|$)/i,
    /\b(?:from|for|on)\s+(?:the\s+)?(.+?)(?:\s*[?.!]|$)/i,
    /\b(?:for|on)\s+(?:the\s+)?(.+?)\s+job\b/i,
  ];
  for (const re of patterns) {
    const m = q.match(re);
    const raw = m?.[1]?.trim();
    if (!raw) continue;
    const cleaned = raw
      .replace(/\b(one|a job|this job|an applicant|applicant|application)\b/gi, "")
      .replace(/[?.!,]+$/g, "")
      .trim();
    if (cleaned.length >= 2) return cleaned;
  }
  return null;
}

/**
 * One or more person names after shortlist/confirm.
 * "shortliste koushik and priya" → ["koushik", "priya"] (does not capture "and").
 */
export function extractApplicantNameHints(question: string): string[] {
  const q = question.trim();
  // Job-scoped shortlist ("shortlist from Software Developer") has no person names.
  if (
    /\b(?:short[\s-]?(?:list(?:ed|ing|e)?|lis|lst|lsit)|shorlist|shortliset)\s+(?:from|for|on)\b/i.test(
      q,
    )
  ) {
    return [];
  }
  const head = q.match(
    /\b(?:confirm|conifrm|confrm|confirn|comfirm|confim|short[\s-]?(?:list(?:ed|ing|e)?|lis|lst|lsit)|shorlist|shortliset|select|pick|choose)\s+(.+)$/i,
  );
  const offerFor = q.match(
    /\b(?:offer|outreach)(?:\s+(?:letter|draft|email|mail))?\s+(?:for|to)\s+(.+)$/i,
  );
  const nameTail = head?.[1] ?? offerFor?.[1];
  if (!nameTail) {
    const single = extractApplicantNameHintLegacy(q);
    return single ? [single] : [];
  }
  const cleaned = nameTail
    .split(/\s+\b(?:from|for|on)\b\s+/i)[0]!
    .replace(/[?.!,]+$/g, "")
    .trim();
  const parts = cleaned
    .split(/\s*(?:,|&|\/|\band\b|\bor\b)\s*/i)
    .map((p) =>
      p
        .replace(/^(?:select|pick|choose|confirm|conifrm|short[\s-]?list(?:ed|ing|e)?)\s+/i, "")
        .trim(),
    )
    .filter((p) => {
      if (p.length < 2) return false;
      if (STOPWORDS.has(p.toLowerCase())) return false;
      if (
        /^(from|for|on|the|this|that|him|her|my|job|applicant|candidate|please|and|or|select|pick|choose)$/i.test(
          p,
        )
      ) {
        return false;
      }
      return /^[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2}$/.test(p);
    });
  return [...new Set(parts)].slice(0, 5);
}

/** Best-effort single person name (first hint). */
export function extractApplicantNameHint(question: string): string | null {
  return extractApplicantNameHints(question)[0] ?? extractApplicantNameHintLegacy(question);
}

/** Legacy single-name patterns kept for confirm/select phrasing. */
function extractApplicantNameHintLegacy(question: string): string | null {
  const q = question.trim();
  const patterns = [
    // Confirm + name (typos included): "confirm Rajon", "conifrm rajon dey"
    /\b(?:confirm|conifrm|confrm|confirn|comfirm|confim)\s+([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+)?)\b/i,
    // Allow typos of shortlist + any casing for the name; stop before and/or.
    /\b(?:short[\s-]?(?:list(?:ed|ing|e)?|lis|lst|lsit)|shorlist|shortliset|select|pick|choose)\s+([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+)?)(?=\s+(?:and|or)\b|,|$|\s+[?.!])/i,
    /\b(?:short[\s-]?(?:list(?:ed|ing|e)?|lis|lst|lsit)|shorlist|shortliset|select|pick|choose)\s+([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+)?)\b/i,
    /\b(?:named|name)\s+([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+)?)\b/i,
    /\bapplicant\s+([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+)?)\b/i,
  ];
  for (const re of patterns) {
    const m = q.match(re);
    const raw = m?.[1]?.trim();
    if (!raw) continue;
    if (STOPWORDS.has(raw.toLowerCase())) continue;
    if (/^(from|for|on|the|this|my|job|and|or)$/i.test(raw)) continue;
    // Reject clear job-title fragments after shortlist-from style asks.
    if (/^(from|for)\b/i.test(raw)) continue;
    return raw;
  }
  return null;
}

function applicantNameMatchesHint(
  name: string,
  needle: string,
  parts: string[],
): boolean {
  if (!name) return false;
  if (name.includes(needle)) return true;
  // All name parts present (order-insensitive): "roy koushik" ≈ "Koushik Roy"
  if (parts.length > 1 && parts.every((p) => name.includes(p))) return true;
  return false;
}

/**
 * Only "applied" can transition to shortlisted in HireHub's status machine.
 * Prefer those when resolving "confirm priya" among duplicate name hits.
 */
export function isShortlistableApplicationStatus(status: string | null | undefined): boolean {
  return String(status ?? "").trim().toLowerCase() === "applied";
}

/**
 * Keep applicants who can still be shortlisted; if none, return the original list
 * so the UI can explain "already shortlisted" / terminal statuses.
 */
export function preferShortlistableApplicants<T extends { status: string }>(applicants: T[]): T[] {
  const ready = applicants.filter((a) => isShortlistableApplicationStatus(a.status));
  return ready.length > 0 ? ready : applicants;
}

/**
 * Match applicants by person name first.
 * Email is only a fallback when no display-name hit exists — otherwise
 * "confirm priya" falsely matches “Dibyo Das” via priya.das+…@email.
 */
export function matchApplicantsByNameHint<
  T extends { id: string; profiles?: { full_name?: string | null; email?: string | null } | null },
>(applicants: T[], nameHint: string): T[] {
  const needle = nameHint.trim().toLowerCase();
  if (!needle) return [];
  const parts = needle.split(/\s+/).filter(Boolean);

  const byName = applicants.filter((a) => {
    const name = (a.profiles?.full_name ?? "").trim().toLowerCase();
    return applicantNameMatchesHint(name, needle, parts);
  });
  if (byName.length > 0) return byName;

  // No name hit — allow email local-part / full email match (nameless profiles).
  return applicants.filter((a) => {
    const name = (a.profiles?.full_name ?? "").trim().toLowerCase();
    const email = (a.profiles?.email ?? "").trim().toLowerCase();
    if (!email) return false;
    // If they already have a different display name, do not match on email substring.
    if (name && !applicantNameMatchesHint(name, needle, parts)) return false;
    if (email.includes(needle)) return true;
    const local = email.split("@")[0] ?? "";
    const tokens = local.split(/[.+_\-]+/).filter(Boolean);
    return tokens.some((t) => t === needle || t.startsWith(needle));
  });
}

export function matchOwnedJobByTitle<T extends { id: string; title: string }>(
  jobs: T[],
  hint: string,
): T | null {
  const ranked = rankOwnedJobsByQuery(jobs, hint);
  if (ranked.length === 0) return null;
  if (ranked.length === 1 || ranked[0]!.score > ranked[1]!.score) return ranked[0]!.job;
  return null;
}

export function rankOwnedJobsByQuery<T extends { id: string; title: string; description?: string | null }>(
  jobs: T[],
  query: string,
): Array<{ job: T; score: number }> {
  const tokens = extractSearchTokens(query);
  const hint = extractJobTitleHint(query);
  if (hint) {
    for (const t of extractSearchTokens(hint)) {
      if (!tokens.includes(t)) tokens.push(t);
    }
  }
  if (tokens.length === 0 || jobs.length === 0) return [];

  return jobs
    .map((job) => {
      const title = String(job.title ?? "")
        .trim()
        .toLowerCase();
      const desc = String(job.description ?? "")
        .toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        if (!tok) continue;
        if (title === tok) score += 8;
        else if (title.includes(tok)) score += 5;
        else if (sharePrefix(tok, title)) score += 3;
        else if (desc.includes(tok)) score += 2;
      }
      // Whole-hint inclusion bonus
      const needle = String(hint ?? query)
        .trim()
        .toLowerCase();
      if (needle.length >= 3 && (title.includes(needle) || needle.includes(title))) score += 4;
      return { job, score };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || String(a.job.title ?? "").localeCompare(String(b.job.title ?? "")),
    );
}

export type RankableApplicant = {
  id: string;
  status: string;
  cover_note?: string | null;
  resume_file_name?: string | null;
  resume_storage_path?: string | null;
  resume_url?: string | null;
  portfolio_url?: string | null;
  profiles?: {
    full_name?: string | null;
    email?: string | null;
    skills?: string | null;
  } | null;
  jobs?: { id: string; title: string; description?: string | null } | null;
};

export type RankedApplicant = {
  applicant: RankableApplicant;
  score: number;
  reasons: string[];
};

/**
 * Rank applicants using recruiter-visible signals: profile name/email/(skills if RLS allows),
 * cover note, resume attachment metadata, and overlap with the owned job title/description.
 * Does not parse PDF bytes.
 */
export function rankApplicantsByProfileAndResume(
  applicants: RankableApplicant[],
  query: string,
  job?: { title: string; description?: string | null } | null,
): RankedApplicant[] {
  const tokens = extractSearchTokens(
    [query, job?.title ?? "", job?.description ?? ""].filter(Boolean).join(" "),
  );
  const nameHint = extractApplicantNameHint(query)?.toLowerCase() ?? null;
  const minYears = extractMinYearsExperience(query);

  return applicants
    .map((applicant) => {
      const name = applicant.profiles?.full_name?.trim() || "";
      const email = applicant.profiles?.email?.trim() || "";
      const skills = applicant.profiles?.skills?.trim() || "";
      const cover = applicant.cover_note?.trim() || "";
      const resumeName = applicant.resume_file_name?.trim() || "";
      const hasResume = Boolean(
        applicant.resume_storage_path || applicant.resume_url || resumeName,
      );
      const haystack = [name, email, skills, cover, resumeName, applicant.portfolio_url ?? ""]
        .join(" ")
        .toLowerCase();

      let score = 0;
      const reasons: string[] = [];

      if (nameHint && name.toLowerCase().includes(nameHint)) {
        score += 12;
        reasons.push(`name matches “${nameHint}”`);
      }

      for (const tok of tokens) {
        if (!tok) continue;
        if (name.toLowerCase().includes(tok)) {
          score += 4;
          reasons.push(`profile name ~ ${tok}`);
        } else if (skills.toLowerCase().includes(tok)) {
          score += 5;
          reasons.push(`skills ~ ${tok}`);
        } else if (cover.toLowerCase().includes(tok)) {
          score += 4;
          reasons.push(`cover note ~ ${tok}`);
        } else if (resumeName.toLowerCase().includes(tok)) {
          score += 3;
          reasons.push(`resume file ~ ${tok}`);
        } else if (haystack.includes(tok)) {
          score += 1;
        }
      }

      if (minYears != null) {
        const yearsHit = haystack.match(/\b(\d+)\s*\+?\s*(?:years?|yrs?)\b/);
        if (yearsHit?.[1]) {
          const mentioned = Number(yearsHit[1]);
          if (Number.isFinite(mentioned) && mentioned >= minYears) {
            score += 6;
            reasons.push(`experience ≥ ${minYears}y in cover/profile text`);
          }
        }
      }

      if (hasResume) {
        score += 2;
        reasons.push("resume on file");
      }
      if (cover.length >= 40) {
        score += 1;
        reasons.push("cover note present");
      }
      if (skills.length > 0) {
        score += 1;
        reasons.push("skills on profile");
      }

      // Prefer not-yet-shortlisted for proposals
      if (String(applicant.status) === "applied") score += 1;

      return {
        applicant,
        score,
        reasons: [...new Set(reasons)].slice(0, 4),
      };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function formatRankedApplicantsReply(
  ranked: RankedApplicant[],
  jobTitle?: string,
): string {
  if (ranked.length === 0) {
    return "No applicants scored against profile/cover note/resume signals for this filter (owned jobs only).";
  }
  const header = jobTitle
    ? `Ranked applicants for “${jobTitle}” (profile + cover note + resume signals; owned job only):`
    : "Ranked applicants across your owned jobs (profile + cover note + resume signals):";
  const lines = ranked.slice(0, 8).map((r, i) => {
    const name = applicantDisplayName({
      full_name: r.applicant.profiles?.full_name,
      email: r.applicant.profiles?.email,
    });
    const title = r.applicant.jobs?.title ?? "Job";
    const why = r.reasons.length ? ` — ${r.reasons.join("; ")}` : "";
    return `${i + 1}. ${name} — ${title} — ${r.applicant.status} (score ${r.score})${why}`;
  });
  return `${header}\n${lines.join("\n")}`;
}

function sharePrefix(a: string, title: string): boolean {
  // "enginners" ≈ "engineers" — match any title word with shared 4+ char prefix.
  const words = title.split(/\s+/);
  for (const w of words) {
    const n = Math.min(a.length, w.length, 6);
    if (n >= 4 && a.slice(0, n) === w.slice(0, n)) return true;
  }
  return false;
}
