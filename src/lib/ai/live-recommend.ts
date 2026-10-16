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
};

/** Minimal Supabase-like client surface used by live recommendations. */
export type LiveJobsClient = {
  // Intentionally loose: matches supabase-js builder chaining without pulling Database types.
  from: (table: "jobs") => {
    select: (columns: string) => {
      eq: (column: string, value: string) => LiveJobsFilterBuilder;
    };
  };
};

type LiveJobsFilterBuilder = {
  order: (column: string, options?: { ascending?: boolean }) => LiveJobsFilterBuilder;
  ilike: (column: string, pattern: string) => LiveJobsFilterBuilder;
  limit: (count: number) => PromiseLike<{
    data: LiveApprovedJob[] | null;
    error: { message: string } | null;
  }>;
};

const liveRecommendInputSchema = z.object({
  query: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export type LiveRecommendInput = z.input<typeof liveRecommendInputSchema>;

export type LiveRecommendResult =
  | { ok: true; jobs: LiveApprovedJob[]; source: "live_jobs_approved" }
  | { ok: false; message: string };

const LIVE_JOB_SELECT = "id,title,description,location,status,company_id,created_at";

/**
 * List genuine approved HireHub jobs for recommendation UIs.
 * Does not query job_corpus and never invents vacancies.
 */
export async function recommendApprovedLiveJobs(
  client: LiveJobsClient,
  input: LiveRecommendInput = {},
): Promise<LiveRecommendResult> {
  const parsed = liveRecommendInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid recommendation input." };
  }

  const limit = parsed.data.limit;
  const q = parsed.data.query?.trim();

  let builder = client.from("jobs").select(LIVE_JOB_SELECT).eq("status", "approved");
  if (q) {
    builder = builder.ilike("title", `%${q}%`);
  }
  const response = await builder.order("created_at", { ascending: false }).limit(limit);

  if (response.error) {
    return { ok: false, message: "Could not load approved jobs." };
  }

  const jobs = (response.data ?? []).filter((job) => job.status === "approved");
  return { ok: true, jobs, source: "live_jobs_approved" };
}

/** Guard used by tests/UI: corpus docs are never live recommendation inputs. */
export function isLiveRecommendationSource(source: string): boolean {
  return source === "live_jobs_approved";
}
