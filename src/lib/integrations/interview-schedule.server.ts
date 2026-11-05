import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isMissingSchemaError } from "@/lib/hirehub-storage";
import { isSupabaseServiceRoleConfigured } from "@/lib/oauth-signup-role";
import { rejectInterviewIdentityFields } from "@/lib/integrations/interview-authorization";
import { INTERVIEW_SCHEMA_PENDING_CODE } from "@/lib/integrations/interview-schedule-persistence";
import { interviewScheduleUserMessage } from "@/lib/integrations/interview-schedule.service";
import {
  queryOpenInterviewScheduleForApplication,
  querySeekerScheduledInterview,
  type InterviewScheduleView,
} from "@/lib/integrations/interview-schedule-queries";
import {
  cancelInterviewById,
  createInterviewScheduleServiceFromAdmin,
  rescheduleInterviewById,
  retryInterviewScheduleById,
  scheduleInterviewForApplication,
  type InterviewApplicationContext,
  type InterviewScheduleApiResult,
} from "@/lib/integrations/interview-schedule.service";

const scheduleSchema = z
  .object({
    applicationId: z.string().uuid(),
    startAt: z.string().min(1),
    endAt: z.string().min(1),
    timezone: z.string().min(1).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const scheduleIdSchema = z.object({ scheduleId: z.string().uuid() }).strict();

const applicationIdSchema = z.object({ applicationId: z.string().uuid() }).strict();

const rescheduleSchema = z
  .object({
    scheduleId: z.string().uuid(),
    startAt: z.string().min(1),
    endAt: z.string().min(1),
    timezone: z.string().min(1).optional(),
  })
  .strict();

async function loadInterviewApplicationContext(input: {
  applicationId: string;
  userSupabase: SupabaseClient;
  userId: string;
}): Promise<
  | { ok: true; context: InterviewApplicationContext; callerRole: string }
  | { ok: false; result: InterviewScheduleApiResult }
> {
  const { data: profile } = await input.userSupabase
    .from("profiles")
    .select("id,role")
    .eq("id", input.userId)
    .maybeSingle();

  if (!profile) {
    return {
      ok: false,
      result: {
        ok: false,
        code: "not_found",
        message: "Interview not found.",
        retryable: false,
      },
    };
  }

  type ApplicationRow = {
    id: string;
    status: InterviewApplicationContext["applicationStatus"];
    seeker_id: string;
    job_id: string;
    jobs:
      | { id: string; title: string; recruiter_id: string; company_id: string }
      | { id: string; title: string; recruiter_id: string; company_id: string }[]
      | null;
  };

  const { data: applicationRaw } = await input.userSupabase
    .from("applications")
    .select("id,status,seeker_id,job_id,jobs!inner(id,title,recruiter_id,company_id)")
    .eq("id", input.applicationId)
    .maybeSingle();

  const application = applicationRaw as ApplicationRow | null;

  if (!application) {
    return {
      ok: false,
      result: {
        ok: false,
        code: "not_found",
        message: "Interview not found.",
        retryable: false,
      },
    };
  }

  const jobJoined = application.jobs;
  const job = Array.isArray(jobJoined) ? jobJoined[0] : jobJoined;
  if (!job) {
    return {
      ok: false,
      result: {
        ok: false,
        code: "not_found",
        message: "Interview not found.",
        retryable: false,
      },
    };
  }

  if (!isSupabaseServiceRoleConfigured()) {
    return {
      ok: false,
      result: {
        ok: false,
        code: "service_role_not_configured",
        message: "Interview scheduling is not available on this server.",
        retryable: false,
      },
    };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [{ data: seeker }, { data: recruiter }] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("email,full_name")
      .eq("id", application.seeker_id)
      .maybeSingle(),
    supabaseAdmin
      .from("profiles")
      .select("email,full_name")
      .eq("id", job.recruiter_id)
      .maybeSingle(),
  ]);

  let companyName: string | null = null;
  if (job.company_id) {
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("name")
      .eq("id", job.company_id)
      .maybeSingle();
    companyName = company?.name ?? null;
  }

  return {
    ok: true,
    callerRole: profile.role,
    context: {
      applicationId: application.id,
      applicationStatus: application.status,
      jobId: job.id,
      jobTitle: job.title || "Interview",
      companyName,
      jobRecruiterId: job.recruiter_id,
      seekerId: application.seeker_id,
      recruiter: {
        email: recruiter?.email ?? "",
        displayName: recruiter?.full_name?.trim() || "Recruiter",
      },
      seeker: {
        email: seeker?.email ?? "",
        displayName: seeker?.full_name?.trim() || "Candidate",
      },
    },
  };
}

async function loadContextForScheduleId(input: {
  scheduleId: string;
  userSupabase: SupabaseClient;
  userId: string;
}): Promise<
  | { ok: true; context: InterviewApplicationContext; callerRole: string; applicationId: string }
  | { ok: false; result: InterviewScheduleApiResult }
> {
  if (!isSupabaseServiceRoleConfigured()) {
    return {
      ok: false,
      result: {
        ok: false,
        code: "service_role_not_configured",
        message: "Interview scheduling is not available on this server.",
        retryable: false,
      },
    };
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  type UntypedAdmin = { from: (t: string) => ReturnType<typeof supabaseAdmin.from> };
  const admin = supabaseAdmin as unknown as UntypedAdmin;
  const { data: row, error } = await admin
    .from("interview_schedules")
    .select("application_id")
    .eq("id", input.scheduleId)
    .maybeSingle();
  if (error) {
    if (isMissingSchemaError(error.message)) {
      return {
        ok: false,
        result: {
          ok: false,
          code: INTERVIEW_SCHEMA_PENDING_CODE,
          message: interviewScheduleUserMessage(INTERVIEW_SCHEMA_PENDING_CODE),
          retryable: false,
        },
      };
    }
    return {
      ok: false,
      result: {
        ok: false,
        code: "not_found",
        message: "Interview not found.",
        retryable: false,
      },
    };
  }
  const applicationId =
    row && typeof row === "object" && "application_id" in row
      ? String((row as { application_id: unknown }).application_id)
      : "";
  if (!applicationId) {
    return {
      ok: false,
      result: {
        ok: false,
        code: "not_found",
        message: "Interview not found.",
        retryable: false,
      },
    };
  }
  const loaded = await loadInterviewApplicationContext({
    applicationId,
    userSupabase: input.userSupabase,
    userId: input.userId,
  });
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    applicationId,
    callerRole: loaded.callerRole,
    context: loaded.context,
  };
}

function parseInterviewBody<T>(schema: z.ZodType<T>, data: unknown): T {
  const identity = rejectInterviewIdentityFields(data);
  if (!identity.ok) throw new Error(identity.code);
  return schema.parse(data);
}

export const scheduleInterview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => parseInterviewBody(scheduleSchema, data))
  .handler(async ({ data, context }): Promise<InterviewScheduleApiResult> => {
    const loaded = await loadInterviewApplicationContext({
      applicationId: data.applicationId,
      userSupabase: context.supabase,
      userId: context.userId,
    });
    if (!loaded.ok) return loaded.result;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const deps = createInterviewScheduleServiceFromAdmin(supabaseAdmin);

    return scheduleInterviewForApplication({
      callerId: context.userId,
      callerRole: loaded.callerRole,
      context: loaded.context,
      startAt: data.startAt,
      endAt: data.endAt,
      ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      deps,
    });
  });

export const retryInterviewSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => parseInterviewBody(scheduleIdSchema, data))
  .handler(async ({ data, context }): Promise<InterviewScheduleApiResult> => {
    const loaded = await loadContextForScheduleId({
      scheduleId: data.scheduleId,
      userSupabase: context.supabase,
      userId: context.userId,
    });
    if (!loaded.ok) return loaded.result;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const deps = createInterviewScheduleServiceFromAdmin(supabaseAdmin);

    return retryInterviewScheduleById({
      callerId: context.userId,
      callerRole: loaded.callerRole,
      scheduleId: data.scheduleId,
      context: loaded.context,
      deps,
    });
  });

export const rescheduleInterview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => parseInterviewBody(rescheduleSchema, data))
  .handler(async ({ data, context }): Promise<InterviewScheduleApiResult> => {
    const loaded = await loadContextForScheduleId({
      scheduleId: data.scheduleId,
      userSupabase: context.supabase,
      userId: context.userId,
    });
    if (!loaded.ok) return loaded.result;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const deps = createInterviewScheduleServiceFromAdmin(supabaseAdmin);

    return rescheduleInterviewById({
      callerId: context.userId,
      callerRole: loaded.callerRole,
      scheduleId: data.scheduleId,
      context: loaded.context,
      startAt: data.startAt,
      endAt: data.endAt,
      ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
      deps,
    });
  });

export const cancelInterviewSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => parseInterviewBody(scheduleIdSchema, data))
  .handler(async ({ data, context }): Promise<InterviewScheduleApiResult> => {
    const loaded = await loadContextForScheduleId({
      scheduleId: data.scheduleId,
      userSupabase: context.supabase,
      userId: context.userId,
    });
    if (!loaded.ok) return loaded.result;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const deps = createInterviewScheduleServiceFromAdmin(supabaseAdmin);

    return cancelInterviewById({
      callerId: context.userId,
      callerRole: loaded.callerRole,
      scheduleId: data.scheduleId,
      context: loaded.context,
      deps,
    });
  });

/** SSR-safe read for recruiter interview panel (JWT + RLS via user Supabase client). */
export const loadOpenInterviewScheduleForApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => parseInterviewBody(applicationIdSchema, data))
  .handler(async ({ data, context }): Promise<InterviewScheduleView | null> => {
    return queryOpenInterviewScheduleForApplication(context.supabase, data.applicationId);
  });

/** SSR-safe read for seeker interview section (JWT + RLS via user Supabase client). */
export const loadSeekerScheduledInterview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => parseInterviewBody(applicationIdSchema, data))
  .handler(async ({ data, context }): Promise<InterviewScheduleView | null> => {
    return querySeekerScheduledInterview(context.supabase, data.applicationId);
  });
