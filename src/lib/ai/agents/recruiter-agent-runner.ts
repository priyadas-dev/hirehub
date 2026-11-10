/**
 * Executes recruiter specialist tools (shortlist / outreach draft) with JWT-scoped DB loads.
 * Invoked only via Supervisor → runRecruiterAgent — not a public bypass entry.
 */

import type { ApplicationStatus } from "@/components/status/status";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  draftRecruiterOutreach,
  planRecruiterShortlist,
  type DraftOutreachResult,
  type RecruiterApplicationRow,
  type RecruiterOwnedJob,
  type ShortlistResult,
} from "@/lib/ai/agents/recruiter";
import { updateApplicationStatusWithNotification } from "@/lib/notify-application-status";
import type { RecruiterSupervisorAgentInput } from "@/lib/ai/agents/supervisor";

export type RecruiterShortlistStatus = Extract<
  ApplicationStatus,
  "shortlisted" | "interview" | "rejected" | "hired"
>;

export type RecruiterAgentRunnerContext = {
  supabase: SupabaseClient;
  callerId: string;
  callerRole: string;
};

export type RecruiterAgentRunnerResult =
  | ShortlistResult
  | { ok: true; status: "updated"; applicationId: string; plannedStatus: ApplicationStatus; message: string }
  | DraftOutreachResult
  | { ok: false; code: "validation" | "forbidden" | "unauthorized" | "db"; message: string };

export async function runRecruiterSpecialistFromSupervisor(
  input: RecruiterSupervisorAgentInput,
  ctx: RecruiterAgentRunnerContext,
): Promise<RecruiterAgentRunnerResult> {
  const deps = { callerId: ctx.callerId, callerRole: ctx.callerRole };

  if (input.kind === "shortlist") {
    const applicationId = input.applicationId?.trim();
    if (!applicationId) {
      return { ok: false, code: "validation", message: "Application id is required to shortlist." };
    }

    const { data: appRow, error } = await ctx.supabase
      .from("applications")
      .select("id,job_id,seeker_id,status,jobs!inner(id,recruiter_id,title)")
      .eq("id", applicationId)
      .maybeSingle();

    if (error || !appRow) {
      return {
        ok: false,
        code: "validation",
        message: error?.message ?? "Application not found.",
      };
    }

    const jobs = appRow.jobs as unknown as { id: string; recruiter_id: string; title: string };
    const application: RecruiterApplicationRow = {
      id: appRow.id,
      jobId: appRow.job_id,
      seekerId: appRow.seeker_id,
      status: appRow.status as ApplicationStatus,
      jobRecruiterId: jobs.recruiter_id,
    };

    const plan = planRecruiterShortlist(
      {
        application,
        status: input.status,
        confirm: Boolean(input.confirm),
      },
      deps,
    );

    if (!plan.ok) return plan;
    if (plan.status === "needs_confirm") return plan;

    try {
      await updateApplicationStatusWithNotification({
        applicationId,
        from: application.status,
        status: plan.plannedStatus,
      });
      return {
        ok: true,
        status: "updated",
        applicationId,
        plannedStatus: plan.plannedStatus,
        message: `Application updated to ${plan.plannedStatus}.`,
      };
    } catch (err) {
      return {
        ok: false,
        code: "db",
        message: err instanceof Error ? err.message : "Failed to update application status.",
      };
    }
  }

  const jobId = input.jobId?.trim();
  if (!jobId) {
    return { ok: false, code: "validation", message: "Job id is required to draft outreach." };
  }

  const { data: jobRow, error: jobError } = await ctx.supabase
    .from("jobs")
    .select("id,title,recruiter_id,company_id")
    .eq("id", jobId)
    .maybeSingle();

  if (jobError || !jobRow) {
    return {
      ok: false,
      code: "validation",
      message: jobError?.message ?? "Job not found.",
    };
  }

  const job: RecruiterOwnedJob = {
    id: jobRow.id,
    title: jobRow.title,
    recruiterId: jobRow.recruiter_id,
    companyId: jobRow.company_id,
  };

  let contact: { id: string; recruiterId: string; email: string; fullName: string | null } | null = null;
  if (input.contactId) {
    const { data: c } = await ctx.supabase
      .from("crm_contacts")
      .select("id,recruiter_id,email,full_name")
      .eq("id", input.contactId)
      .maybeSingle();
    if (c) {
      contact = {
        id: c.id,
        recruiterId: c.recruiter_id,
        email: c.email,
        fullName: c.full_name,
      };
    }
  }

  let segment: { id: string; recruiterId: string; name: string } | null = null;
  if (input.segmentId) {
    const { data: s } = await ctx.supabase
      .from("crm_segments")
      .select("id,recruiter_id,name")
      .eq("id", input.segmentId)
      .maybeSingle();
    if (s) {
      segment = { id: s.id, recruiterId: s.recruiter_id, name: s.name };
    }
  }

  // Supervisor NL path never sets confirmSend; structured API may only when caller explicitly opts in.
  const confirmSend = Boolean(input.confirmSend);
  return draftRecruiterOutreach(
    {
      job,
      contact,
      segment,
      confirmSend,
    },
    deps,
  );
}
