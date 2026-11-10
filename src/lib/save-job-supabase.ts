/**
 * Supabase JWT-backed adapter for saveJob.
 * Uses the caller's supabase client (user session) — never service role.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SaveJobClient } from "@/lib/save-job";

export function createSupabaseSaveJobClient(supabase: SupabaseClient): SaveJobClient {
  return {
    async findApprovedJob(jobId) {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,title")
        .eq("id", jobId)
        .eq("status", "approved")
        .maybeSingle();
      return {
        data: data ? { id: data.id, title: data.title } : null,
        error: error ? { message: error.message } : null,
      };
    },
    async findExistingSavedJob(jobId, seekerId) {
      const { data, error } = await supabase
        .from("saved_jobs")
        .select("id")
        .eq("job_id", jobId)
        .eq("seeker_id", seekerId)
        .maybeSingle();
      return { data: data ?? null, error: error ? { message: error.message } : null };
    },
    async insertSavedJob(row) {
      const { data, error } = await supabase.from("saved_jobs").insert(row).select("id").single();
      return {
        data: data ?? null,
        error: error ? { code: error.code, message: error.message } : null,
      };
    },
  };
}
