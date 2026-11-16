/**
 * Supabase JWT-backed adapter for applyToJob.
 * Uses the caller's supabase client (user session) — never service role.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApplyToJobClient, ApplyToJobRow } from "@/lib/apply-to-job";

export function createSupabaseApplyToJobClient(supabase: SupabaseClient): ApplyToJobClient {
  return {
    async findApprovedJob(jobId) {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,status,application_deadline,description")
        .eq("id", jobId)
        .eq("status", "approved")
        .maybeSingle();
      return { data: data ?? null, error: error ? { message: error.message } : null };
    },
    async findExistingApplication(jobId, seekerId) {
      const { data, error } = await supabase
        .from("applications")
        .select("id")
        .eq("job_id", jobId)
        .eq("seeker_id", seekerId)
        .maybeSingle();
      return { data: data ?? null, error: error ? { message: error.message } : null };
    },
    async insertApplication(row: ApplyToJobRow) {
      const { data, error } = await supabase.from("applications").insert(row).select("id").single();
      return {
        data: data ?? null,
        error: error ? { code: error.code, message: error.message } : null,
      };
    },
    async updateSeekerProfile({ seekerId, fullName, email }) {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: fullName, email })
        .eq("id", seekerId);
      return { error: error ? { message: error.message } : null };
    },
  };
}
