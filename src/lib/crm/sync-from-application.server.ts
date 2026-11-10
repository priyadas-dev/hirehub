import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildCrmContactSyncPayload } from "@/lib/crm/sync-from-application";
import { isSupabaseServiceRoleConfigured } from "@/lib/oauth-signup-role";

const requestSchema = z.object({
  applicationId: z.string().uuid(),
});

export type SyncCrmFromApplicationResult =
  | { ok: true; created: boolean; updated: boolean; skipped?: string }
  | { ok: false; error: string };

/**
 * Upsert CRM contact from a single application after AuthZ.
 * Allowed callers: owning recruiter, admin, or the seeker who owns the application.
 * Service role used only after AuthZ to read seeker email/skills and write CRM.
 */
export const syncCrmContactFromApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => requestSchema.parse(data))
  .handler(async ({ data, context }): Promise<SyncCrmFromApplicationResult> => {
    try {
      if (!isSupabaseServiceRoleConfigured()) {
        return { ok: true, created: false, updated: false, skipped: "service_role_not_configured" };
      }

      const { data: caller } = await context.supabase
        .from("profiles")
        .select("id,role")
        .eq("id", context.userId)
        .maybeSingle();
      if (!caller) return { ok: false, error: "Caller profile not found" };

      // Application readable via JWT for seeker owner, job owner, or admin.
      const { data: application, error: appError } = await context.supabase
        .from("applications")
        .select("id,status,seeker_id,job_id,jobs!inner(id,recruiter_id,job_category_id,job_categories(name))")
        .eq("id", data.applicationId)
        .maybeSingle();

      if (appError || !application) {
        return { ok: false, error: appError?.message || "Application not found" };
      }

      const jobs = application.jobs as
        | {
            id: string;
            recruiter_id: string;
            job_categories?: { name?: string | null } | { name?: string | null }[] | null;
          }
        | {
            id: string;
            recruiter_id: string;
            job_categories?: { name?: string | null } | { name?: string | null }[] | null;
          }[];
      const job = Array.isArray(jobs) ? jobs[0] : jobs;
      const catEmbed = job?.job_categories;
      const catRow = Array.isArray(catEmbed) ? catEmbed[0] : catEmbed;
      const jobCategoryLabel = catRow?.name?.trim() || "Other";
      if (!job?.recruiter_id) return { ok: false, error: "Job ownership missing" };

      const isAdmin = caller.role === "admin";
      const isRecruiterOwner = caller.role === "recruiter" && job.recruiter_id === context.userId;
      const isSeekerOwner =
        (caller.role === "job_seeker" || caller.role === "admin") &&
        application.seeker_id === context.userId;
      // Seekers may sync their own apply; recruiters sync owned pipeline.
      if (!isAdmin && !isRecruiterOwner && !(caller.role === "job_seeker" && application.seeker_id === context.userId)) {
        return { ok: false, error: "Not authorized to sync this application" };
      }
      void isSeekerOwner;

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as unknown as { from: (t: string) => any };

      const { data: seeker, error: seekerError } = await admin
        .from("profiles")
        .select("id,email,full_name,skills")
        .eq("id", application.seeker_id)
        .maybeSingle();
      if (seekerError || !seeker) {
        return { ok: false, error: seekerError?.message || "Seeker profile not found" };
      }

      const emailNormalized = String(seeker.email ?? "")
        .trim()
        .toLowerCase();
      let existingCategories: string[] = [];
      if (emailNormalized) {
        const existing = await admin
          .from("crm_contacts")
          .select("job_categories")
          .eq("recruiter_id", job.recruiter_id)
          .eq("email_normalized", emailNormalized)
          .maybeSingle();
        if (Array.isArray(existing.data?.job_categories)) {
          existingCategories = existing.data.job_categories as string[];
        }
      }

      const payload = buildCrmContactSyncPayload(
        {
          recruiterId: job.recruiter_id,
          seekerProfileId: application.seeker_id,
          email: String(seeker.email ?? ""),
          fullName: (seeker.full_name as string | null) ?? null,
          skillsText: (seeker.skills as string | null) ?? null,
          applicationStatus: application.status,
          jobCategory: jobCategoryLabel,
        },
        existingCategories,
      );
      if ("error" in payload) {
        return { ok: true, created: false, updated: false, skipped: payload.error };
      }

      const row = {
        recruiter_id: payload.recruiterId,
        email: payload.email,
        email_normalized: payload.emailNormalized,
        full_name: payload.fullName,
        seeker_profile_id: payload.seekerProfileId,
        application_status: payload.applicationStatus,
        segment_kind: payload.segmentKind,
        skills: payload.skills,
        job_categories: payload.jobCategories,
        updated_at: new Date().toISOString(),
      };

      const { data: inserted, error: insertError } = await admin
        .from("crm_contacts")
        .insert({ ...row, job_interests: [] })
        .select("id")
        .maybeSingle();

      if (!insertError && inserted) {
        return { ok: true, created: true, updated: false };
      }

      if (insertError && (insertError.code === "23505" || /duplicate|unique/i.test(String(insertError.message)))) {
        const { error: updateError } = await admin
          .from("crm_contacts")
          .update(row)
          .eq("recruiter_id", payload.recruiterId)
          .eq("email_normalized", payload.emailNormalized);
        if (updateError) {
          return { ok: false, error: String(updateError.message ?? updateError) };
        }
        return { ok: true, created: false, updated: true };
      }

      if (insertError && /job_categories/i.test(String(insertError.message ?? ""))) {
        // Migration not applied yet — store categories in job_interests as soft fallback.
        const fallback = {
          recruiter_id: payload.recruiterId,
          email: payload.email,
          email_normalized: payload.emailNormalized,
          full_name: payload.fullName,
          seeker_profile_id: payload.seekerProfileId,
          application_status: payload.applicationStatus,
          segment_kind: payload.segmentKind,
          skills: payload.skills,
          job_interests: payload.jobCategories,
          updated_at: new Date().toISOString(),
        };
        const retry = await admin.from("crm_contacts").insert(fallback).select("id").maybeSingle();
        if (!retry.error && retry.data) return { ok: true, created: true, updated: false };
        if (retry.error && (retry.error.code === "23505" || /duplicate|unique/i.test(String(retry.error.message)))) {
          await admin
            .from("crm_contacts")
            .update(fallback)
            .eq("recruiter_id", payload.recruiterId)
            .eq("email_normalized", payload.emailNormalized);
          return { ok: true, created: false, updated: true };
        }
        return { ok: false, error: String(retry.error?.message ?? insertError.message) };
      }

      return { ok: false, error: String(insertError?.message ?? "CRM sync failed") };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "CRM sync failed" };
    }
  });
