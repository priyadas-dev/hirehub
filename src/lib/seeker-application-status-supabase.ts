/**
 * Supabase JWT-backed adapter for checkSeekerApplicationStatus.
 * Filters by authenticated seeker_id so RLS + explicit eq double-scope ownership.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SeekerApplicationStatusClient,
  SeekerApplicationStatusRow,
} from "@/lib/seeker-application-status";

type JobJoin = {
  id?: string | null;
  title?: string | null;
  location?: string | null;
  companies?: { name?: string | null } | null;
};

export function createSupabaseSeekerApplicationStatusClient(
  supabase: SupabaseClient,
): SeekerApplicationStatusClient {
  return {
    async listForSeeker({ seekerId, jobId, applicationId, pageSize, offset }) {
      const from = Math.max(0, offset);
      const to = from + Math.max(1, pageSize) - 1;

      let query = supabase
        .from("applications")
        .select("id,status,created_at,job_id,jobs(id,title,location,companies(name))")
        .eq("seeker_id", seekerId)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (applicationId) query = query.eq("id", applicationId);
      if (jobId) query = query.eq("job_id", jobId);

      const { data, error } = await query;
      if (error) return { data: [], error: { message: error.message } };

      const rows: SeekerApplicationStatusRow[] = (data ?? []).map((row) => {
        const job = row.jobs as JobJoin | JobJoin[] | null;
        const jobRow = Array.isArray(job) ? job[0] : job;
        return {
          id: row.id,
          status: row.status,
          createdAt: row.created_at,
          jobId: row.job_id,
          jobTitle: jobRow?.title?.trim() || "Job",
          companyName: jobRow?.companies?.name ?? null,
          location: jobRow?.location ?? null,
        };
      });

      return { data: rows, error: null };
    },
  };
}
