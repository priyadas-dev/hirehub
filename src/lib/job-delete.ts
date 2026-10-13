import { supabase } from "@/integrations/supabase/client";

/**
 * Jobs reference applications with ON DELETE CASCADE in the core schema.
 * We never silently cascade-delete applications — block delete when any exist.
 */
export async function countApplicationsForJob(jobId: string): Promise<number> {
  const { count, error } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);
  if (error) throw error;
  return count ?? 0;
}

export function canDeleteJobWithApplications(appCount: number): { ok: true } | { ok: false; reason: string } {
  if (appCount > 0) {
    return {
      ok: false,
      reason: `This job has ${appCount} application${appCount === 1 ? "" : "s"}. Deleting it would remove those applications. Close the job instead to keep candidate records.`,
    };
  }
  return { ok: true };
}

/**
 * Delete a job owned by the signed-in recruiter.
 * Refuses when applications exist. Scoped by recruiter_id so other owners cannot be deleted.
 */
export async function deleteOwnJob(jobId: string, recruiterId: string) {
  const appCount = await countApplicationsForJob(jobId);
  const gate = canDeleteJobWithApplications(appCount);
  if (!gate.ok) throw new Error(gate.reason);

  const { data, error } = await supabase
    .from("jobs")
    .delete()
    .eq("id", jobId)
    .eq("recruiter_id", recruiterId)
    .select("id");
  if (error) throw error;
  if (!data?.length) {
    throw new Error("Job could not be deleted. It may not exist or is not owned by you.");
  }
  return data[0];
}
