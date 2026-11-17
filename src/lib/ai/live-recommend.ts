import { z } from "zod";

/**
 * Live HireHub recommendations — completely separate from corpus RAG.
 * Queries only genuine `public.jobs` with status = approved via the caller's
 * authenticated Supabase client (RLS applies). Never reads job_corpus.
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
  "id,title,description,location,status,company_id,created_at,job_type,companies(name)";

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

/** Expand informal skill words into title/description-friendly tokens. */
const TERM_ALIASES: Record<string, string[]> = {
  coding: ["software", "developer", "engineer", "programming"],
  code: ["software", "developer", "engineer"],
  programming: ["software", "developer", "engineer"],
  engineering: ["engineer", "software"],
  frontend: ["frontend", "front-end", "react", "ui"],
  backend: ["backend", "back-end", "api", "server"],
  fullstack: ["full-stack", "fullstack", "full", "stack"],
  "full-stack": ["full-stack", "fullstack", "software", "developer"],
  devops: ["devops", "sre", "infrastructure"],
};

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
]);

export function isRoleHeavyLiveQuery(parsed: ParsedLiveJobQuery): boolean {
  return parsed.terms.some((t) => ROLE_TITLE_TERMS.has(t.toLowerCase()));
}

export function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Parse NL filters without treating the whole sentence as a title.
 * Supports full-time / part-time / contract, remote, and location/skill tokens.
 */
export function parseLiveJobQuery(query: string): ParsedLiveJobQuery {
  const normalized = query
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
    terms.push(token);
  };
  for (const token of raw) {
    if (token.length < 3) continue;
    if (LIVE_SEARCH_STOP_WORDS.has(token)) continue;
    if (locations.includes(token)) continue;
    const aliases = TERM_ALIASES[token];
    if (aliases) {
      for (const alias of aliases) pushTerm(alias);
    } else {
      pushTerm(token);
    }
    if (terms.length >= 8) break;
  }

  return { terms, jobTypes, locations, remoteOnly };
}

/** @deprecated Prefer parseLiveJobQuery — kept for existing imports/tests. */
export function extractLiveJobSearchTerms(query: string): string[] {
  return parseLiveJobQuery(query).terms;
}

function companyNameFromRow(row: Record<string, unknown>): string | null {
  const companies = row.companies;
  if (companies && typeof companies === "object" && !Array.isArray(companies)) {
    const name = (companies as { name?: unknown }).name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  }
  if (Array.isArray(companies) && companies[0] && typeof companies[0] === "object") {
    const name = (companies[0] as { name?: unknown }).name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  }
  return null;
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
  };
}

function scoreLiveJob(job: LiveApprovedJob, parsed: ParsedLiveJobQuery): number {
  const title = job.title.toLowerCase();
  const desc = (job.description ?? "").toLowerCase();
  const loc = (job.location ?? "").toLowerCase();
  const company = (job.company_name ?? "").toLowerCase();
  let score = 0;

  for (const term of parsed.terms) {
    if (title.includes(term)) score += 6;
    if (company.includes(term)) score += 3;
    if (desc.includes(term)) score += 2;
    if (loc.includes(term)) score += 2;
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
  // Location / type / remote filters are authoritative. Residual chat words like
  // "there" must not exclude otherwise valid approved jobs.
  if (parsed.terms.length > 0 && !hasStructuralFilters(parsed)) {
    const title = job.title.toLowerCase();
    const hay =
      `${job.title} ${job.description ?? ""} ${job.company_name ?? ""} ${job.location ?? ""}`.toLowerCase();
    // Role searches (software / engineer / developer / …) must match the TITLE so
    // marketing/HR/labor cards with a stray keyword in the description are excluded.
    if (isRoleHeavyLiveQuery(parsed)) {
      if (!parsed.terms.some((t) => title.includes(t))) return false;
    } else if (!parsed.terms.some((t) => hay.includes(t))) {
      return false;
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

  let builder = client.from("jobs").select(LIVE_JOB_SELECT).eq("status", "approved");

  if (parsed.jobTypes.length === 1) {
    builder = builder.eq("job_type", parsed.jobTypes[0]!);
  } else if (parsed.jobTypes.length > 1) {
    builder = builder.in("job_type", parsed.jobTypes);
  }

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

  // Broad OR fetch, then precise client filter/rank. Avoids excluding valid matches.
  if (orParts.length > 0) {
    builder = builder.or(orParts.join(","));
  }

  const fetchLimit = Math.min(50, Math.max(limit * 4, 20));
  const response = await builder.order("created_at", { ascending: false }).limit(fetchLimit);

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
