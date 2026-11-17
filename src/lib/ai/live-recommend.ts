import { z } from "zod";
import {
  expandLiveSearchToken,
  LIVE_TERM_ALIASES,
  normalizeLiveJobQuestion,
  SHORT_ABBREV_TOKENS,
} from "@/lib/ai/live-query-understand";

/**
 * Live HireHub recommendations — completely separate from corpus RAG.
 * Queries only genuine `public.jobs` with status = approved via the caller's
 * authenticated Supabase client (RLS applies). Never reads job_corpus.
 *
 * Query understanding (typos / IT / finance synonyms) lives in
 * `live-query-understand.ts`. Corpus RAG may expand empty searches in Discovery
 * but never supplies applyable job cards.
 */

export type LiveApprovedJob = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  status: string;
  company_id: string;
  created_at: string;
  job_type: string | null;
  company_name: string | null;
  /** Optional catalog category name when the join is available. */
  category_name?: string | null;
};

export type ParsedLiveJobQuery = {
  terms: string[];
  jobTypes: Array<"full_time" | "part_time" | "contract">;
  locations: string[];
  remoteOnly: boolean;
};

/** Minimal Supabase-like client surface used by live recommendations. */
export type LiveJobsClient = {
  from: (table: "jobs") => {
    select: (columns: string) => {
      eq: (column: string, value: string) => LiveJobsFilterBuilder;
    };
  };
};

type LiveJobsFilterBuilder = {
  eq: (column: string, value: string) => LiveJobsFilterBuilder;
  order: (column: string, options?: { ascending?: boolean }) => LiveJobsFilterBuilder;
  ilike: (column: string, pattern: string) => LiveJobsFilterBuilder;
  or: (filters: string) => LiveJobsFilterBuilder;
  in: (column: string, values: string[]) => LiveJobsFilterBuilder;
  limit: (count: number) => PromiseLike<{
    data: Array<Record<string, unknown>> | null;
    error: { message: string } | null;
  }>;
};

const liveRecommendInputSchema = z.object({
  query: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export type LiveRecommendInput = z.input<typeof liveRecommendInputSchema>;

export type LiveRecommendResult =
  | { ok: true; jobs: LiveApprovedJob[]; source: "live_jobs_approved"; matchCount: number }
  | { ok: false; message: string };

const LIVE_JOB_SELECT =
  "id,title,description,location,status,company_id,created_at,job_type,companies(name),job_categories(name)";

const LIVE_SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "me",
  "my",
  "i",
  "im",
  "find",
  "show",
  "get",
  "give",
  "gimme",
  "looking",
  "look",
  "want",
  "need",
  "needed",
  "please",
  "job",
  "jobs",
  "jpb",
  "any",
  "there",
  "role",
  "roles",
  "position",
  "positions",
  "opening",
  "openings",
  "vacancy",
  "vacancies",
  "for",
  "as",
  "with",
  "in",
  "on",
  "at",
  "to",
  "of",
  "and",
  "or",
  "any",
  "there",
  "here",
  "available",
  "anywhere",
  "somewhere",
  "nearby",
  "near",
  "around",
  "currently",
  "right",
  "now",
  "these",
  "those",
  "this",
  "that",
  "are",
  "is",
  "was",
  "were",
  "be",
  "been",
  "being",
  "more",
  "similar",
  "some",
  "like",
  "about",
  "what",
  "which",
  "how",
  "can",
  "could",
  "would",
  "should",
  "from",
  "into",
  "over",
  "under",
  "than",
  "then",
  "them",
  "they",
  "we",
  "you",
  "your",
  "hirehub",
  "assistant",
  "recommend",
  "recommendations",
  "suggest",
  "suggested",
  "skills",
  "skill",
  "career",
  "advice",
  "experience",
  "prepare",
  "interview",
  "follow",
  "up",
  "again",
  "related",
  "know",
  "time",
  "full",
  "part",
  "type",
  "resume",
  "cv",
  "based",
  "match",
  "matches",
  "matching",
  "suitable",
  "prefer",
  "preferred",
]);

/** @deprecated Prefer LIVE_TERM_ALIASES from live-query-understand. */
const TERM_ALIASES: Record<string, string[]> = LIVE_TERM_ALIASES;

/** Career-role tokens that must hit the job TITLE (not description-only noise). */
const ROLE_TITLE_TERMS = new Set([
  "software",
  "engineer",
  "developer",
  "frontend",
  "front-end",
  "backend",
  "back-end",
  "fullstack",
  "full-stack",
  "devops",
  "intern",
  "qa",
  "testing",
  "test",
  "sre",
  "programming",
  "programmer",
  "technology",
]);

/**
 * Experience-level tokens may appear in ROLE_TITLE_TERMS (e.g. intern) but alone must
 * not force title-only filtering — "freshers in Sylhet" should still surface software roles.
 */
const EXPERIENCE_LEVEL_TERMS = new Set([
  "intern",
  "junior",
  "senior",
  "entry",
  "fresher",
  "graduate",
]);

/** Industry terms that must not match only via company name substring (e.g. Manor IT). */
const TITLE_OR_CATEGORY_PREFERRED = new Set([
  "finance",
  "financial",
  "banking",
  "accounting",
  "accountant",
  "marketing",
  "sales",
  "hr",
  "design",
  "designer",
]);

export function isRoleHeavyLiveQuery(parsed: ParsedLiveJobQuery): boolean {
  return parsed.terms.some((t) => {
    const lower = t.toLowerCase();
    return ROLE_TITLE_TERMS.has(lower) && !EXPERIENCE_LEVEL_TERMS.has(lower);
  });
}

export function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Parse NL filters without treating the whole sentence as a title.
 * Supports full-time / part-time / contract, remote, location, industry aliases,
 * abbreviations (IT/HR/QA), and common typos (finace → finance).
 */
export function parseLiveJobQuery(query: string): ParsedLiveJobQuery {
  const understood = normalizeLiveJobQuestion(query);
  const normalized = understood
    .toLowerCase()
    .replace(/full[\s-]?time/g, " full_time ")
    .replace(/part[\s-]?time/g, " part_time ")
    .replace(/[^a-z0-9+#._\s-]/g, " ");

  const jobTypes: ParsedLiveJobQuery["jobTypes"] = [];
  if (/\bfull_time\b/.test(normalized)) jobTypes.push("full_time");
  if (/\bpart_time\b/.test(normalized)) jobTypes.push("part_time");
  if (/\bcontract\b/.test(normalized)) jobTypes.push("contract");

  const remoteOnly = /\bremote\b/.test(normalized);

  const locations: string[] = [];
  for (const loc of ["dhaka", "sylhet", "chittagong", "chattogram", "khulna", "rajshahi"]) {
    if (normalized.includes(loc) && !locations.includes(loc)) locations.push(loc);
  }

  const raw = normalized
    .replace(/\bfull_time\b/g, " ")
    .replace(/\bpart_time\b/g, " ")
    .replace(/\bcontract\b/g, " ")
    .replace(/\bremote\b/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const terms: string[] = [];
  const pushTerm = (token: string) => {
    if (!token || terms.includes(token)) return;
    // Keep short abbrevs only when explicitly allow-listed (after expansion most are longer).
    if (token.length < 3 && !SHORT_ABBREV_TOKENS.has(token)) return;
    terms.push(token);
  };
  for (const token of raw) {
    if (LIVE_SEARCH_STOP_WORDS.has(token)) continue;
    if (locations.includes(token)) continue;
    // Min length: allow 2-char abbrevs through expandLiveSearchToken.
    if (token.length < 2) continue;
    if (token.length < 3 && !SHORT_ABBREV_TOKENS.has(token)) continue;

    const expanded = expandLiveSearchToken(token);
    for (const alias of expanded) pushTerm(alias);
    // Also keep legacy alias table coverage if expand returned empty.
    if (!expanded.length) {
      const aliases = TERM_ALIASES[token];
      if (aliases) for (const alias of aliases) pushTerm(alias);
      else pushTerm(token);
    }
    if (terms.length >= 12) break;
  }

  return { terms, jobTypes, locations, remoteOnly };
}

/** @deprecated Prefer parseLiveJobQuery — kept for existing imports/tests. */
export function extractLiveJobSearchTerms(query: string): string[] {
  return parseLiveJobQuery(query).terms;
}

function nestedName(
  row: Record<string, unknown>,
  key: "companies" | "job_categories",
): string | null {
  const nested = row[key];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const name = (nested as { name?: unknown }).name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  }
  if (Array.isArray(nested) && nested[0] && typeof nested[0] === "object") {
    const name = (nested[0] as { name?: unknown }).name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  }
  return null;
}

function companyNameFromRow(row: Record<string, unknown>): string | null {
  return nestedName(row, "companies");
}

function categoryNameFromRow(row: Record<string, unknown>): string | null {
  return nestedName(row, "job_categories");
}

/** Word-boundary aware match so short tokens like "hr" do not hit random substrings. */
export function textMatchesTerm(haystack: string, term: string): boolean {
  const h = haystack.toLowerCase();
  const t = term.toLowerCase();
  if (!t) return false;
  if (t.length <= 2) {
    return new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(
      h,
    );
  }
  return h.includes(t);
}

function normalizeLiveJob(row: Record<string, unknown>): LiveApprovedJob | null {
  const id = typeof row.id === "string" ? row.id : null;
  const title = typeof row.title === "string" ? row.title : null;
  const status = typeof row.status === "string" ? row.status : null;
  const companyId = typeof row.company_id === "string" ? row.company_id : null;
  const createdAt = typeof row.created_at === "string" ? row.created_at : null;
  if (!id || !title || !status || !companyId || !createdAt) return null;

  return {
    id,
    title,
    description: typeof row.description === "string" ? row.description : null,
    location: typeof row.location === "string" ? row.location : null,
    status,
    company_id: companyId,
    created_at: createdAt,
    job_type: typeof row.job_type === "string" ? row.job_type : null,
    company_name: companyNameFromRow(row),
    category_name: categoryNameFromRow(row),
  };
}

function scoreLiveJob(job: LiveApprovedJob, parsed: ParsedLiveJobQuery): number {
  const title = job.title.toLowerCase();
  const desc = (job.description ?? "").toLowerCase();
  const loc = (job.location ?? "").toLowerCase();
  const company = (job.company_name ?? "").toLowerCase();
  const category = (job.category_name ?? "").toLowerCase();
  let score = 0;

  for (const term of parsed.terms) {
    if (textMatchesTerm(title, term)) score += 6;
    if (category && textMatchesTerm(category, term)) score += 5;
    if (textMatchesTerm(company, term)) score += 3;
    if (textMatchesTerm(desc, term)) score += 2;
    if (textMatchesTerm(loc, term)) score += 2;
  }
  for (const location of parsed.locations) {
    if (loc.includes(location)) score += 5;
  }
  if (parsed.remoteOnly && loc.includes("remote")) score += 5;
  if (parsed.jobTypes.length && job.job_type && parsed.jobTypes.includes(job.job_type as never)) {
    score += 4;
  }
  return score;
}

function hasStructuralFilters(parsed: ParsedLiveJobQuery): boolean {
  return parsed.jobTypes.length > 0 || parsed.locations.length > 0 || parsed.remoteOnly;
}

function passesClientFilters(job: LiveApprovedJob, parsed: ParsedLiveJobQuery): boolean {
  if (parsed.jobTypes.length > 0) {
    if (!job.job_type || !parsed.jobTypes.includes(job.job_type as never)) return false;
  }
  if (parsed.remoteOnly) {
    if (!(job.location ?? "").toLowerCase().includes("remote")) return false;
  }
  if (parsed.locations.length > 0) {
    const loc = (job.location ?? "").toLowerCase();
    if (!parsed.locations.some((l) => loc.includes(l))) return false;
  }
  // Location / type / remote filters are authoritative for structure, but role /
  // industry terms must still apply so "IT in Sylhet" does not return HR in Sylhet.
  if (parsed.terms.length > 0) {
    const title = job.title;
    const category = job.category_name ?? "";
    const hay = `${job.title} ${job.description ?? ""} ${job.company_name ?? ""} ${job.location ?? ""} ${category}`;
    const roleHeavy = isRoleHeavyLiveQuery(parsed);
    const industryPreferred = parsed.terms.some((t) =>
      TITLE_OR_CATEGORY_PREFERRED.has(t.toLowerCase()),
    );

    if (roleHeavy) {
      // Role searches must match the TITLE (not description-only noise).
      if (!parsed.terms.some((t) => textMatchesTerm(title, t))) return false;
    } else if (industryPreferred) {
      // Finance/marketing/HR: prefer title or category — not company-only (Manor IT).
      if (
        !parsed.terms.some(
          (t) => textMatchesTerm(title, t) || (category && textMatchesTerm(category, t)),
        )
      ) {
        return false;
      }
    } else if (!hasStructuralFilters(parsed)) {
      // Residual chat words must not exclude jobs when only structural filters remain.
      if (!parsed.terms.some((t) => textMatchesTerm(hay, t))) return false;
    }
  }
  return true;
}

/** True when the query is driven by location / job type / remote (not skill keywords). */
export function isStructuralJobFilterQuery(query: string): boolean {
  return hasStructuralFilters(parseLiveJobQuery(query));
}

/**
 * Build a query that keeps only explicit NL filters (type / remote / location).
 * Used when widening skill-based candidate pools without dropping user filters.
 */
export function buildLiveJobFilterQuery(query: string): string {
  const parsed = parseLiveJobQuery(query);
  const parts: string[] = [];
  for (const type of parsed.jobTypes) {
    if (type === "full_time") parts.push("full-time");
    else if (type === "part_time") parts.push("part-time");
    else parts.push(type);
  }
  if (parsed.remoteOnly) parts.push("remote");
  for (const loc of parsed.locations) parts.push(loc);
  return parts.join(" ");
}

/** Apply type / remote / location filters from a seeker question to a job list. */
export function filterLiveJobsByQuery(jobs: LiveApprovedJob[], query: string): LiveApprovedJob[] {
  const parsed = parseLiveJobQuery(query);
  // Drop content terms so skill ranking can keep jobs that match skills but not every keyword.
  const filterOnly: ParsedLiveJobQuery = {
    terms: [],
    jobTypes: parsed.jobTypes,
    locations: parsed.locations,
    remoteOnly: parsed.remoteOnly,
  };
  if (
    filterOnly.jobTypes.length === 0 &&
    filterOnly.locations.length === 0 &&
    !filterOnly.remoteOnly
  ) {
    return jobs;
  }
  return jobs.filter((job) => passesClientFilters(job, filterOnly));
}

/**
 * Keep role relevance after skill-pool merges.
 * When the seeker asked for software/engineer/etc., drop cards whose titles do not match.
 */
export function filterLiveJobsByRoleRelevance(
  jobs: LiveApprovedJob[],
  query: string,
): LiveApprovedJob[] {
  const parsed = parseLiveJobQuery(query);
  if (!isRoleHeavyLiveQuery(parsed)) return jobs;
  return jobs.filter((job) => passesClientFilters(job, parsed));
}

/**
 * List genuine approved HireHub jobs for recommendation UIs.
 * Does not query job_corpus and never invents vacancies.
 */
export async function recommendApprovedLiveJobs(
  client: LiveJobsClient,
  input: LiveRecommendInput = {},
): Promise<LiveRecommendResult> {
  const parsedInput = liveRecommendInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return {
      ok: false,
      message: parsedInput.error.issues[0]?.message ?? "Invalid recommendation input.",
    };
  }

  const limit = parsedInput.data.limit;
  const q = parsedInput.data.query?.trim();
  const parsed = q
    ? parseLiveJobQuery(q)
    : { terms: [], jobTypes: [], locations: [], remoteOnly: false };

  const orParts: string[] = [];
  for (const term of parsed.terms) {
    const pattern = `%${escapeIlikePattern(term)}%`;
    orParts.push(
      `title.ilike."${pattern}"`,
      `description.ilike."${pattern}"`,
      `location.ilike."${pattern}"`,
    );
  }
  for (const location of parsed.locations) {
    const pattern = `%${escapeIlikePattern(location)}%`;
    orParts.push(`location.ilike."${pattern}"`);
  }
  if (parsed.remoteOnly) {
    orParts.push(`location.ilike."%remote%"`);
  }

  const fetchLimit = Math.min(50, Math.max(limit * 4, 20));

  const runQuery = async (selectCols: string) => {
    let builder = client.from("jobs").select(selectCols).eq("status", "approved");
    if (parsed.jobTypes.length === 1) {
      builder = builder.eq("job_type", parsed.jobTypes[0]!);
    } else if (parsed.jobTypes.length > 1) {
      builder = builder.in("job_type", parsed.jobTypes);
    }
    // Broad OR fetch, then precise client filter/rank. Avoids excluding valid matches.
    if (orParts.length > 0) {
      builder = builder.or(orParts.join(","));
    }
    return builder.order("created_at", { ascending: false }).limit(fetchLimit);
  };

  // Prefer category join for industry matching; fall back if the relationship is unavailable.
  let response = await runQuery(LIVE_JOB_SELECT);
  if (response.error && /job_categor/i.test(response.error.message)) {
    response = await runQuery(
      "id,title,description,location,status,company_id,created_at,job_type,companies(name)",
    );
  }

  if (response.error) {
    return { ok: false, message: "Could not load approved jobs." };
  }

  const seen = new Set<string>();
  const jobs = (response.data ?? [])
    .map((row) => normalizeLiveJob(row))
    .filter((job): job is LiveApprovedJob => {
      if (!job || job.status !== "approved") return false;
      if (seen.has(job.id)) return false;
      seen.add(job.id);
      return passesClientFilters(job, parsed);
    })
    .sort((a, b) => {
      const scoreDiff = scoreLiveJob(b, parsed) - scoreLiveJob(a, parsed);
      if (scoreDiff !== 0) return scoreDiff;
      return b.created_at.localeCompare(a.created_at);
    })
    .slice(0, limit);

  return { ok: true, jobs, source: "live_jobs_approved", matchCount: jobs.length };
}

/** Guard used by tests/UI: corpus docs are never live recommendation inputs. */
export function isLiveRecommendationSource(source: string): boolean {
  return source === "live_jobs_approved";
}
