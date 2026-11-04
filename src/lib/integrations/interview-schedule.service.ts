import type { ApplicationStatus } from "@/components/status/status";
import {
  cancelInterviewEvent,
  createInterviewEvent,
  discardUninvitedEvent,
  getInterviewEvent,
  requestConferenceRetry,
  rescheduleInterviewEvent,
  sendInterviewInvitations,
  type InterviewAttendee,
} from "@/lib/integrations/google-calendar";
import {
  interviewAccessDeniedCode,
  isAuthorizedInterviewManager,
  isSchedulableApplicationStatus,
  validateInterviewAttendees,
  validateInterviewWindow,
} from "@/lib/integrations/interview-authorization";
import {
  createInterviewScheduleRepository,
  dbRowToOrchestratorRow,
  INTERVIEW_SCHEMA_PENDING_CODE,
  type InterviewScheduleDbRow,
  type InterviewScheduleRepository,
} from "@/lib/integrations/interview-schedule-persistence";
import {
  advanceInterview,
  cancelInterview,
  type AdvanceInterviewResult,
  type CancelInterviewFlowResult,
  type InterviewGoogleClient,
  type InterviewOrchestratorDeps,
} from "@/lib/integrations/interview-orchestrator";

export type InterviewScheduleApiSuccess = {
  ok: true;
  state: "scheduled" | "awaiting_meet" | "cancelled";
  scheduleId: string;
};

export type InterviewScheduleApiFailure = {
  ok: false;
  code: string;
  message: string;
  retryable: boolean;
  scheduleId?: string;
};

export type InterviewScheduleApiResult = InterviewScheduleApiSuccess | InterviewScheduleApiFailure;

export function interviewScheduleUserMessage(code: string): string {
  switch (code) {
    case "not_found":
      return "Interview not found.";
    case "identity_fields_forbidden":
      return "Invalid request.";
    case INTERVIEW_SCHEMA_PENDING_CODE:
      return "Interview scheduling is not available until the database migration is applied.";
    case "application_not_found":
      return "Application not found.";
    case "invalid_application_status":
      return "Interviews can only be scheduled for shortlisted or interview-stage applications.";
    case "invalid_time":
      return "Interview start or end time is invalid.";
    case "invalid_time_range":
      return "Interview must be between 15 minutes and 4 hours long.";
    case "invalid_timezone":
      return "Timezone is invalid.";
    case "start_too_soon":
      return "Interview must start at least 15 minutes from now.";
    case "recruiter_email_invalid":
    case "seeker_email_invalid":
      return "Recruiter or candidate email is missing or invalid.";
    case "attendee_emails_must_differ":
      return "Recruiter and candidate must use different email addresses.";
    case "interview_exists":
      return "An interview is already scheduled for this application.";
    case "google_not_configured":
      return "Google Calendar is not configured on the server.";
    case "service_role_not_configured":
      return "Interview scheduling is not available on this server.";
    case "in_progress":
      return "Interview scheduling is already in progress. Wait a moment and try again.";
    case "meet_creation_failed":
      return "Google could not create the Meet link. Try Retry Meet link.";
    case "meet_attempts_exhausted":
      return "Meet link retries are exhausted. Cancel this interview and schedule again.";
    case "invite_failed":
      return "The Meet link is ready but invitations could not be sent. Try again.";
    case "interview_not_advanceable":
      return "This interview cannot be updated.";
    default:
      if (code.startsWith("google_")) return "Could not reach Google Calendar. Try again.";
      return "Something went wrong scheduling the interview.";
  }
}

function fail(code: string, retryable = false, scheduleId?: string): InterviewScheduleApiFailure {
  return {
    ok: false,
    code,
    message: interviewScheduleUserMessage(code),
    retryable,
    ...(scheduleId ? { scheduleId } : {}),
  };
}

function okAdvance(result: AdvanceInterviewResult): InterviewScheduleApiResult {
  if (result.ok) {
    return { ok: true, state: result.state, scheduleId: result.scheduleId };
  }
  return fail(result.code, result.retryable, result.scheduleId);
}

function okCancel(result: CancelInterviewFlowResult): InterviewScheduleApiResult {
  if (result.ok) {
    return { ok: true, state: "cancelled", scheduleId: result.scheduleId };
  }
  return fail(result.code, result.retryable, result.scheduleId);
}

export function createDefaultInterviewGoogleClient(): InterviewGoogleClient {
  return {
    createInterviewEvent,
    getInterviewEvent,
    sendInterviewInvitations,
    requestConferenceRetry,
    discardUninvitedEvent,
    cancelInterviewEvent,
    rescheduleInterviewEvent,
  };
}

export type InterviewApplicationContext = {
  applicationId: string;
  applicationStatus: ApplicationStatus;
  jobId: string;
  jobTitle: string;
  companyName: string | null;
  jobRecruiterId: string;
  seekerId: string;
  recruiter: InterviewAttendee;
  seeker: InterviewAttendee;
};

export type InterviewScheduleServiceDeps = {
  repository: InterviewScheduleRepository;
  google: InterviewGoogleClient;
  now?: () => Date;
};

function orchestratorDeps(deps: InterviewScheduleServiceDeps): InterviewOrchestratorDeps {
  const out: InterviewOrchestratorDeps = {
    google: deps.google,
    store: deps.repository,
  };
  if (deps.now) out.now = deps.now;
  return out;
}

function rowContext(
  db: InterviewScheduleDbRow,
  ctx: InterviewApplicationContext,
  notes?: string | null,
) {
  const rowCtx: {
    jobTitle: string;
    companyName?: string | null;
    recruiter: InterviewAttendee;
    seeker: InterviewAttendee;
    notes?: string | null;
  } = {
    jobTitle: ctx.jobTitle,
    companyName: ctx.companyName,
    recruiter: ctx.recruiter,
    seeker: ctx.seeker,
  };
  if (notes) rowCtx.notes = notes;
  return dbRowToOrchestratorRow(db, rowCtx);
}

async function assertManagerAccess(
  callerId: string,
  callerRole: string | null | undefined,
  jobRecruiterId: string,
): Promise<InterviewScheduleApiFailure | null> {
  if (
    !isAuthorizedInterviewManager({
      callerId,
      callerRole,
      jobRecruiterId,
    })
  ) {
    return fail(interviewAccessDeniedCode());
  }
  return null;
}

async function ensureSchema(
  deps: InterviewScheduleServiceDeps,
): Promise<InterviewScheduleApiFailure | null> {
  const ready = await deps.repository.probeReady();
  if (!ready) return fail(INTERVIEW_SCHEMA_PENDING_CODE);
  return null;
}

export async function scheduleInterviewForApplication(input: {
  callerId: string;
  callerRole: string | null | undefined;
  context: InterviewApplicationContext;
  startAt: string;
  endAt: string;
  timezone?: string;
  notes?: string | null;
  deps: InterviewScheduleServiceDeps;
}): Promise<InterviewScheduleApiResult> {
  const schema = await ensureSchema(input.deps);
  if (schema) return schema;

  const denied = await assertManagerAccess(
    input.callerId,
    input.callerRole,
    input.context.jobRecruiterId,
  );
  if (denied) return denied;

  if (!isSchedulableApplicationStatus(input.context.applicationStatus)) {
    return fail("invalid_application_status");
  }

  const windowInput: {
    startAt: string;
    endAt: string;
    timezone?: string;
    nowMs: number;
  } = {
    startAt: input.startAt,
    endAt: input.endAt,
    nowMs: (input.deps.now ?? (() => new Date()))().getTime(),
  };
  if (input.timezone !== undefined) windowInput.timezone = input.timezone;
  const window = validateInterviewWindow(windowInput);
  if (!window.ok) return fail(window.code);

  const attendees = validateInterviewAttendees(input.context.recruiter, input.context.seeker);
  if (!attendees.ok) return fail(attendees.code);

  const ctx = {
    ...input.context,
    recruiter: attendees.recruiter,
    seeker: attendees.seeker,
  };

  let dbRow: InterviewScheduleDbRow;
  try {
    const existing = await input.deps.repository.findOpenByApplicationId(ctx.applicationId);
    if (existing?.status === "scheduled" && existing.meet_link && existing.invited_at) {
      return fail("interview_exists", false, existing.id);
    }
    if (existing) {
      dbRow = existing;
    } else {
      dbRow = await input.deps.repository.insertPending({
        applicationId: ctx.applicationId,
        jobId: ctx.jobId,
        recruiterId: ctx.jobRecruiterId,
        seekerId: ctx.seekerId,
        scheduledBy: input.callerId,
        startAt: input.startAt,
        endAt: input.endAt,
        timezone: window.timezone,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/duplicate|unique|23505/i.test(msg)) return fail("interview_exists");
    throw e;
  }

  const orchRow = rowContext(dbRow, ctx, input.notes);
  const advanced = await advanceInterview(orchRow, orchestratorDeps(input.deps));
  return okAdvance(advanced);
}

export async function retryInterviewScheduleById(input: {
  callerId: string;
  callerRole: string | null | undefined;
  scheduleId: string;
  context: InterviewApplicationContext;
  deps: InterviewScheduleServiceDeps;
}): Promise<InterviewScheduleApiResult> {
  const schema = await ensureSchema(input.deps);
  if (schema) return schema;

  const denied = await assertManagerAccess(
    input.callerId,
    input.callerRole,
    input.context.jobRecruiterId,
  );
  if (denied) return denied;

  const dbRow = await input.deps.repository.loadById(input.scheduleId);
  if (!dbRow || dbRow.application_id !== input.context.applicationId) {
    return fail(interviewAccessDeniedCode());
  }
  if (dbRow.recruiter_id !== input.context.jobRecruiterId) {
    return fail(interviewAccessDeniedCode());
  }
  if (dbRow.status !== "pending" && dbRow.status !== "failed") {
    return fail("interview_not_advanceable", false, dbRow.id);
  }

  const attendees = validateInterviewAttendees(input.context.recruiter, input.context.seeker);
  if (!attendees.ok) return fail(attendees.code);

  const orchRow = rowContext(dbRow, {
    ...input.context,
    recruiter: attendees.recruiter,
    seeker: attendees.seeker,
  });

  const intent = dbRow.status === "failed" ? "retry_meet" : "advance";
  const advanced = await advanceInterview(orchRow, orchestratorDeps(input.deps), { intent });
  return okAdvance(advanced);
}

export async function rescheduleInterviewById(input: {
  callerId: string;
  callerRole: string | null | undefined;
  scheduleId: string;
  context: InterviewApplicationContext;
  startAt: string;
  endAt: string;
  timezone?: string;
  deps: InterviewScheduleServiceDeps;
}): Promise<InterviewScheduleApiResult> {
  const schema = await ensureSchema(input.deps);
  if (schema) return schema;

  const denied = await assertManagerAccess(
    input.callerId,
    input.callerRole,
    input.context.jobRecruiterId,
  );
  if (denied) return denied;

  const dbRow = await input.deps.repository.loadById(input.scheduleId);
  if (!dbRow || dbRow.application_id !== input.context.applicationId) {
    return fail(interviewAccessDeniedCode());
  }
  if (dbRow.status !== "scheduled" || !dbRow.google_event_id) {
    return fail("interview_not_advanceable", false, dbRow.id);
  }

  const rescheduleWindowInput: {
    startAt: string;
    endAt: string;
    timezone?: string;
    nowMs: number;
  } = {
    startAt: input.startAt,
    endAt: input.endAt,
    nowMs: (input.deps.now ?? (() => new Date()))().getTime(),
  };
  if (input.timezone !== undefined) rescheduleWindowInput.timezone = input.timezone;
  const window = validateInterviewWindow(rescheduleWindowInput);
  if (!window.ok) return fail(window.code);

  const attendees = validateInterviewAttendees(input.context.recruiter, input.context.seeker);
  if (!attendees.ok) return fail(attendees.code);

  const rescheduled = await input.deps.google.rescheduleInterviewEvent({
    eventId: dbRow.google_event_id,
    startAt: input.startAt,
    endAt: input.endAt,
    timezone: window.timezone,
    recruiterEmail: attendees.recruiter.email,
    seekerEmail: attendees.seeker.email,
  });
  if (!rescheduled.ok) {
    return fail(rescheduled.reason, rescheduled.retryable, dbRow.id);
  }

  await input.deps.repository.updateTimes(dbRow.id, {
    startAt: input.startAt,
    endAt: input.endAt,
    timezone: window.timezone,
    rescheduleCount: dbRow.reschedule_count + 1,
  });

  return { ok: true, state: "scheduled", scheduleId: dbRow.id };
}

export async function cancelInterviewById(input: {
  callerId: string;
  callerRole: string | null | undefined;
  scheduleId: string;
  context: InterviewApplicationContext;
  deps: InterviewScheduleServiceDeps;
}): Promise<InterviewScheduleApiResult> {
  const schema = await ensureSchema(input.deps);
  if (schema) return schema;

  const denied = await assertManagerAccess(
    input.callerId,
    input.callerRole,
    input.context.jobRecruiterId,
  );
  if (denied) return denied;

  const dbRow = await input.deps.repository.loadById(input.scheduleId);
  if (!dbRow || dbRow.application_id !== input.context.applicationId) {
    return fail(interviewAccessDeniedCode());
  }

  const attendees = validateInterviewAttendees(input.context.recruiter, input.context.seeker);
  if (!attendees.ok) return fail(attendees.code);

  const orchRow = rowContext(dbRow, {
    ...input.context,
    recruiter: attendees.recruiter,
    seeker: attendees.seeker,
  });

  return okCancel(await cancelInterview(orchRow, orchestratorDeps(input.deps)));
}

/** Factory used by server functions after AuthZ (service role only). */
export function createInterviewScheduleServiceFromAdmin(
  admin: unknown,
): InterviewScheduleServiceDeps {
  return {
    repository: createInterviewScheduleRepository(
      admin as Parameters<typeof createInterviewScheduleRepository>[0],
    ),
    google: createDefaultInterviewGoogleClient(),
  };
}
