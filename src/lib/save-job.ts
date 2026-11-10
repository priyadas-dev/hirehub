/**
 * Idempotent saved-job helper for the Application Agent.
 * Relies on DB UNIQUE (seeker_id, job_id). Callers must use the JWT client — never service role.
 * Seeker id must come from the authenticated session, never from free-text input.
 */

import { isUniqueViolation } from "@/lib/apply-to-job";

export type SaveJobClient = {
  findApprovedJob: (
    jobId: string,
  ) => Promise<{ data: { id: string; title: string } | null; error: { message: string } | null }>;
  findExistingSavedJob: (
    jobId: string,
    seekerId: string,
  ) => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
  insertSavedJob: (row: {
    job_id: string;
    seeker_id: string;
  }) => Promise<{ data: { id: string } | null; error: { code?: string; message: string } | null }>;
};

export type SaveJobInput = {
  jobId: string;
  /** Authenticated seeker id only — never from user-controlled body fields. */
  seekerId: string;
};

export type SaveJobResult =
  | { ok: true; status: "saved" | "already_saved"; savedJobId: string; jobId: string; title: string }
  | {
      ok: false;
      code: "unauthorized" | "unavailable" | "validation" | "db";
      message: string;
    };

/**
 * Save once per (seeker_id, job_id). Pre-check + UNIQUE + 23505 → already_saved.
 */
export async function saveJob(client: SaveJobClient, input: SaveJobInput): Promise<SaveJobResult> {
  const seekerId = input.seekerId.trim();
  const jobId = input.jobId.trim();
  if (!seekerId) {
    return { ok: false, code: "unauthorized", message: "Sign in as a job seeker to save jobs." };
  }
  if (!jobId) {
    return { ok: false, code: "validation", message: "Choose a job to save." };
  }

  const live = await client.findApprovedJob(jobId);
  if (live.error) return { ok: false, code: "db", message: live.error.message };
  if (!live.data) {
    return { ok: false, code: "unavailable", message: "This job is no longer available to save." };
  }

  const existing = await client.findExistingSavedJob(jobId, seekerId);
  if (existing.error) return { ok: false, code: "db", message: existing.error.message };
  if (existing.data) {
    return {
      ok: true,
      status: "already_saved",
      savedJobId: existing.data.id,
      jobId,
      title: live.data.title,
    };
  }

  const inserted = await client.insertSavedJob({ job_id: jobId, seeker_id: seekerId });
  if (inserted.error) {
    if (isUniqueViolation(inserted.error)) {
      const again = await client.findExistingSavedJob(jobId, seekerId);
      if (again.data) {
        return {
          ok: true,
          status: "already_saved",
          savedJobId: again.data.id,
          jobId,
          title: live.data.title,
        };
      }
    }
    return { ok: false, code: "db", message: inserted.error.message };
  }
  if (!inserted.data) {
    return { ok: false, code: "db", message: "Could not save this job." };
  }

  return {
    ok: true,
    status: "saved",
    savedJobId: inserted.data.id,
    jobId,
    title: live.data.title,
  };
}
