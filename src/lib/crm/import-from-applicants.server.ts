import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeContactEmail } from "@/lib/crm/contacts";
import {
  planApplicantImport,
  summarizeApplicantImport,
  type ApplicantImportRow,
  type SeekerProfileLite,
} from "@/lib/crm/import-from-applicants";
import { DEFAULT_JOB_CATEGORY_NAME } from "@/lib/job-categories";
import { isSupabaseServiceRoleConfigured } from "@/lib/oauth-signup-role";

export type ImportApplicantsToCrmResult = {
  ok: boolean;
  imported: number;
  updated: number;
  skipped: number;
  skippedMissingEmail?: number;
  skippedDuplicate?: number;
  skippedUnauthorizedJob?: number;
  error?: string;
};

/**
 * Secure CRM import from applicants.
 * JWT AuthZ first; service role only afterward for seeker profile emails/skills
 * (profiles RLS is own/admin — recruiters cannot embed emails client-side).
 */
export const importApplicantsToCrm = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(
  async ({ context }): Promise<ImportApplicantsToCrmResult> => {
    try {
      const { data: profile } = await context.supabase
        .from("profiles")
        .select("id,role")
        .eq("id", context.userId)
        .maybeSingle();

      if (!profile) {
        return { ok: false, imported: 0, updated: 0, skipped: 0, error: "Caller profile not found" };
      }

      if (profile.role !== "recruiter" && profile.role !== "admin") {
        return {
          ok: false,
          imported: 0,
          updated: 0,
          skipped: 0,
          error: "Only recruiters or admins may import CRM contacts",
        };
      }

      if (!isSupabaseServiceRoleConfigured()) {
        return {
          ok: false,
          imported: 0,
          updated: 0,
          skipped: 0,
          error: "Server is not configured for secure applicant import",
        };
      }

      let appsQuery = context.supabase
        .from("applications")
        .select("status,seeker_id,jobs!inner(id,recruiter_id,job_category_id,job_categories(name))");

      if (profile.role === "recruiter") {
        appsQuery = appsQuery.eq("jobs.recruiter_id", context.userId);
      }

      const { data: appRows, error: appsError } = await appsQuery;
      if (appsError) {
        // job category catalog may be missing until PROPOSED_0024 is applied — fall back.
        if (/job_category|job_categories/i.test(appsError.message)) {
          let legacy = context.supabase
            .from("applications")
            .select("status,seeker_id,jobs!inner(id,recruiter_id)");
          if (profile.role === "recruiter") {
            legacy = legacy.eq("jobs.recruiter_id", context.userId);
          }
          const fallback = await legacy;
          if (fallback.error) {
            return { ok: false, imported: 0, updated: 0, skipped: 0, error: fallback.error.message };
          }
          return await runImport(context.userId, profile.role, fallback.data ?? [], true);
        }
        return { ok: false, imported: 0, updated: 0, skipped: 0, error: appsError.message };
      }

      return await runImport(context.userId, profile.role, appRows ?? [], false);
    } catch (e) {
      return {
        ok: false,
        imported: 0,
        updated: 0,
        skipped: 0,
        error: e instanceof Error ? e.message : "Import failed",
      };
    }
  },
);

async function runImport(
  callerId: string,
  callerRole: string,
  appRows: Record<string, unknown>[],
  categoryMissing: boolean,
): Promise<ImportApplicantsToCrmResult> {
  const applications: ApplicantImportRow[] = [];
  for (const row of appRows) {
    const jobs = row.jobs as
      | {
          id?: string;
          recruiter_id?: string;
          job_category_id?: string | null;
          job_categories?: { name?: string | null } | { name?: string | null }[] | null;
        }
      | {
          id?: string;
          recruiter_id?: string;
          job_category_id?: string | null;
          job_categories?: { name?: string | null } | { name?: string | null }[] | null;
        }[]
      | null;
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    const jobRecruiterId = job?.recruiter_id;
    const seekerId = row.seeker_id;
    if (!jobRecruiterId || typeof seekerId !== "string") continue;
    const catEmbed = job?.job_categories;
    const catRow = Array.isArray(catEmbed) ? catEmbed[0] : catEmbed;
    const categoryName =
      categoryMissing ? DEFAULT_JOB_CATEGORY_NAME : (catRow?.name?.trim() || DEFAULT_JOB_CATEGORY_NAME);
    applications.push({
      seekerId,
      status: String(row.status ?? "applied"),
      jobRecruiterId,
      jobCategory: categoryName,
    });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as { from: (table: string) => any };

  const ownerRecruiterIds = [...new Set(applications.map((a) => a.jobRecruiterId))];
  const existingEmailsByRecruiterId = new Map<string, Set<string>>();
  const existingCategoriesByRecruiterEmail = new Map<string, string[]>();

  for (const ownerId of ownerRecruiterIds) {
    const existingRes = await admin
      .from("crm_contacts")
      .select("email_normalized,job_categories")
      .eq("recruiter_id", ownerId);
    const set = new Set<string>();
    for (const row of (existingRes.data ?? []) as {
      email_normalized?: string;
      job_categories?: string[] | null;
    }[]) {
      if (typeof row.email_normalized === "string" && row.email_normalized) {
        set.add(row.email_normalized);
        existingCategoriesByRecruiterEmail.set(
          `${ownerId}:${row.email_normalized}`,
          Array.isArray(row.job_categories) ? row.job_categories : [],
        );
      }
    }
    existingEmailsByRecruiterId.set(ownerId, set);
  }

  const seekerIds = [
    ...new Set(
      applications
        .filter((a) => (callerRole === "admin" ? true : a.jobRecruiterId === callerId))
        .map((a) => a.seekerId),
    ),
  ];
  const profilesBySeekerId = new Map<string, SeekerProfileLite>();

  if (seekerIds.length > 0) {
    const profilesRes = await admin.from("profiles").select("id,email,full_name,skills").in("id", seekerIds);
    if (profilesRes.error) {
      // skills column may be missing on very old DBs
      const legacy = await admin.from("profiles").select("id,email,full_name").in("id", seekerIds);
      if (legacy.error) {
        return { ok: false, imported: 0, updated: 0, skipped: 0, error: String(legacy.error.message ?? legacy.error) };
      }
      for (const row of (legacy.data ?? []) as {
        id?: string;
        email?: string | null;
        full_name?: string | null;
      }[]) {
        if (!row.id) continue;
        profilesBySeekerId.set(String(row.id), {
          email: typeof row.email === "string" ? row.email : null,
          fullName: typeof row.full_name === "string" ? row.full_name : null,
          skillsText: null,
        });
      }
    } else {
      for (const row of (profilesRes.data ?? []) as {
        id?: string;
        email?: string | null;
        full_name?: string | null;
        skills?: string | null;
      }[]) {
        if (!row.id) continue;
        profilesBySeekerId.set(String(row.id), {
          email: typeof row.email === "string" ? row.email : null,
          fullName: typeof row.full_name === "string" ? row.full_name : null,
          skillsText: typeof row.skills === "string" ? row.skills : null,
        });
      }
    }
  }

  const plan = planApplicantImport({
    callerId,
    callerRole,
    applications,
    profilesBySeekerId,
    existingEmailsByRecruiterId,
    existingCategoriesByRecruiterEmail,
  });

  let imported = 0;
  let updated = 0;
  let skippedDuplicate = plan.skippedDuplicate;

  for (const item of plan.toInsert) {
    const { error } = await admin
      .from("crm_contacts")
      .insert({
        recruiter_id: item.recruiterId,
        email: item.email,
        email_normalized: item.emailNormalized || normalizeContactEmail(item.email),
        full_name: item.fullName,
        seeker_profile_id: item.seekerProfileId,
        application_status: item.applicationStatus,
        segment_kind: item.segmentKind,
        skills: item.skills,
        job_interests: [],
        job_categories: item.jobCategories.length
          ? item.jobCategories
          : [DEFAULT_JOB_CATEGORY_NAME],
      })
      .select("id")
      .maybeSingle();

    if (error) {
      if (error.code === "23505" || /duplicate|unique/i.test(String(error.message ?? ""))) {
        skippedDuplicate += 1;
        continue;
      }
      // job_categories column missing — retry without it
      if (/job_categories/i.test(String(error.message ?? ""))) {
        const retry = await admin
          .from("crm_contacts")
          .insert({
            recruiter_id: item.recruiterId,
            email: item.email,
            email_normalized: item.emailNormalized,
            full_name: item.fullName,
            seeker_profile_id: item.seekerProfileId,
            application_status: item.applicationStatus,
            segment_kind: item.segmentKind,
            skills: item.skills,
            job_interests: item.jobCategories,
          })
          .select("id")
          .maybeSingle();
        if (retry.error) {
          return {
            ok: false,
            imported,
            updated,
            skipped: plan.skippedMissingEmail + skippedDuplicate + plan.skippedUnauthorizedJob,
            error: String(retry.error.message ?? retry.error),
          };
        }
        imported += 1;
        continue;
      }
      return {
        ok: false,
        imported,
        updated,
        skipped: plan.skippedMissingEmail + skippedDuplicate + plan.skippedUnauthorizedJob,
        error: String(error.message ?? error),
      };
    }
    imported += 1;
  }

  for (const item of plan.toUpdate) {
    const patch: Record<string, unknown> = {
      full_name: item.fullName,
      seeker_profile_id: item.seekerProfileId,
      application_status: item.applicationStatus,
      segment_kind: item.segmentKind,
      skills: item.skills,
      job_categories: item.jobCategories,
      updated_at: new Date().toISOString(),
    };
    const { error } = await admin
      .from("crm_contacts")
      .update(patch)
      .eq("recruiter_id", item.recruiterId)
      .eq("email_normalized", item.emailNormalized);
    if (error && /job_categories/i.test(String(error.message ?? ""))) {
      await admin
        .from("crm_contacts")
        .update({
          full_name: item.fullName,
          seeker_profile_id: item.seekerProfileId,
          application_status: item.applicationStatus,
          segment_kind: item.segmentKind,
          skills: item.skills,
          job_interests: item.jobCategories,
          updated_at: new Date().toISOString(),
        })
        .eq("recruiter_id", item.recruiterId)
        .eq("email_normalized", item.emailNormalized);
    } else if (error) {
      return {
        ok: false,
        imported,
        updated,
        skipped: plan.skippedMissingEmail + skippedDuplicate + plan.skippedUnauthorizedJob,
        error: String(error.message ?? error),
      };
    }
    updated += 1;
  }

  const summary = summarizeApplicantImport({
    ...plan,
    imported,
    updated,
    skippedDuplicate,
  });

  return {
    ok: true,
    imported: summary.imported,
    updated: summary.updated,
    skipped: summary.skipped,
    skippedMissingEmail: plan.skippedMissingEmail,
    skippedDuplicate,
    skippedUnauthorizedJob: plan.skippedUnauthorizedJob,
  };
}
