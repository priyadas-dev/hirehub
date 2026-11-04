import { isMissingSchemaError } from "@/lib/hirehub-storage";
import type {
  ConferenceStatus,
  InterviewAttendee,
  InterviewResponse,
} from "@/lib/integrations/google-calendar";
import type {
  InterviewLifecycleStatus,
  InterviewOrchestratorRow,
  InterviewOrchestratorStore,
  InterviewRowWrite,
} from "@/lib/integrations/interview-orchestrator";

export const INTERVIEW_SCHEMA_PENDING_CODE = "interview_schema_not_ready";

export type InterviewScheduleDbRow = {
  id: string;
  application_id: string;
  job_id: string;
  recruiter_id: string;
  seeker_id: string;
  scheduled_by: string | null;
  start_at: string;
  end_at: string;
  timezone: string;
  status: InterviewLifecycleStatus;
  google_calendar_id: string | null;
  google_event_id: string | null;
  html_link: string | null;
  etag: string | null;
  meet_link: string | null;
  conference_status: ConferenceStatus;
  conference_attempt: number;
  invited_at: string | null;
  lease_until: string | null;
  recruiter_response: InterviewResponse;
  seeker_response: InterviewResponse;
  reschedule_count: number;
  failure_reason: string | null;
};

type AdminClient = {
  from: (table: string) => {
    select: (
      cols: string,
      opts?: { head?: boolean; count?: string },
    ) => {
      limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }>;
      eq: (
        col: string,
        val: string,
      ) => {
        maybeSingle: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
        in: (
          col2: string,
          vals: string[],
        ) => {
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => {
        single: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message: string; code?: string } | null;
        }>;
      };
    };
    update: (row: Record<string, unknown>) => {
      eq: (col: string, val: string) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function mapInterviewScheduleRow(raw: Record<string, unknown>): InterviewScheduleDbRow {
  return {
    id: str(raw["id"]),
    application_id: str(raw["application_id"]),
    job_id: str(raw["job_id"]),
    recruiter_id: str(raw["recruiter_id"]),
    seeker_id: str(raw["seeker_id"]),
    scheduled_by: raw["scheduled_by"] ? str(raw["scheduled_by"]) : null,
    start_at: str(raw["start_at"]),
    end_at: str(raw["end_at"]),
    timezone: str(raw["timezone"]) || "Asia/Dhaka",
    status: str(raw["status"]) as InterviewLifecycleStatus,
    google_calendar_id: raw["google_calendar_id"] ? str(raw["google_calendar_id"]) : null,
    google_event_id: raw["google_event_id"] ? str(raw["google_event_id"]) : null,
    html_link: raw["html_link"] ? str(raw["html_link"]) : null,
    etag: raw["etag"] ? str(raw["etag"]) : null,
    meet_link: raw["meet_link"] ? str(raw["meet_link"]) : null,
    conference_status: (str(raw["conference_status"]) || "pending") as ConferenceStatus,
    conference_attempt: num(raw["conference_attempt"], 1),
    invited_at: raw["invited_at"] ? str(raw["invited_at"]) : null,
    lease_until: raw["lease_until"] ? str(raw["lease_until"]) : null,
    recruiter_response: (str(raw["recruiter_response"]) || "needsAction") as InterviewResponse,
    seeker_response: (str(raw["seeker_response"]) || "needsAction") as InterviewResponse,
    reschedule_count: num(raw["reschedule_count"], 0),
    failure_reason: raw["failure_reason"] ? str(raw["failure_reason"]) : null,
  };
}

export function dbRowToOrchestratorRow(
  row: InterviewScheduleDbRow,
  context: {
    jobTitle: string;
    companyName?: string | null;
    recruiter: InterviewAttendee;
    seeker: InterviewAttendee;
    notes?: string | null;
  },
): InterviewOrchestratorRow {
  const out: InterviewOrchestratorRow = {
    id: row.id,
    applicationId: row.application_id,
    jobTitle: context.jobTitle,
    startAt: row.start_at,
    endAt: row.end_at,
    timezone: row.timezone,
    status: row.status,
    googleEventId: row.google_event_id,
    googleCalendarId: row.google_calendar_id,
    htmlLink: row.html_link,
    etag: row.etag,
    meetLink: row.meet_link,
    conferenceStatus: row.conference_status,
    conferenceAttempt: row.conference_attempt,
    invitedAt: row.invited_at,
    recruiter: context.recruiter,
    seeker: context.seeker,
  };
  if (context.companyName) out.companyName = context.companyName;
  if (context.notes) out.notes = context.notes;
  return out;
}

function writeToDb(patch: InterviewRowWrite): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.status !== undefined) out["status"] = patch.status;
  if (patch.googleEventId !== undefined) out["google_event_id"] = patch.googleEventId;
  if (patch.googleCalendarId !== undefined) out["google_calendar_id"] = patch.googleCalendarId;
  if (patch.htmlLink !== undefined) out["html_link"] = patch.htmlLink;
  if (patch.etag !== undefined) out["etag"] = patch.etag;
  if (patch.meetLink !== undefined) out["meet_link"] = patch.meetLink;
  if (patch.conferenceStatus !== undefined) out["conference_status"] = patch.conferenceStatus;
  if (patch.conferenceAttempt !== undefined) out["conference_attempt"] = patch.conferenceAttempt;
  if (patch.invitedAt !== undefined) out["invited_at"] = patch.invitedAt;
  if (patch.recruiterResponse !== undefined) out["recruiter_response"] = patch.recruiterResponse;
  if (patch.seekerResponse !== undefined) out["seeker_response"] = patch.seekerResponse;
  if (patch.failureReason !== undefined) out["failure_reason"] = patch.failureReason;
  return out;
}

export async function probeInterviewScheduleSchema(admin: AdminClient): Promise<boolean> {
  const { error } = await admin.from("interview_schedules").select("id").limit(1);
  if (error && isMissingSchemaError(error.message)) return false;
  if (
    error &&
    /could not find the table|relation .* does not exist|schema cache/i.test(error.message)
  ) {
    return false;
  }
  return true;
}

export type InterviewScheduleRepository = InterviewOrchestratorStore & {
  probeReady(): Promise<boolean>;
  findOpenByApplicationId(applicationId: string): Promise<InterviewScheduleDbRow | null>;
  loadById(scheduleId: string): Promise<InterviewScheduleDbRow | null>;
  insertPending(input: {
    applicationId: string;
    jobId: string;
    recruiterId: string;
    seekerId: string;
    scheduledBy: string;
    startAt: string;
    endAt: string;
    timezone: string;
  }): Promise<InterviewScheduleDbRow>;
  updateTimes(
    scheduleId: string,
    input: { startAt: string; endAt: string; timezone: string; rescheduleCount: number },
  ): Promise<void>;
};

export function createInterviewScheduleRepository(admin: AdminClient): InterviewScheduleRepository {
  return {
    async probeReady() {
      return probeInterviewScheduleSchema(admin);
    },

    async findOpenByApplicationId(applicationId) {
      const { data, error } = await admin
        .from("interview_schedules")
        .select("*")
        .eq("application_id", applicationId)
        .in("status", ["pending", "scheduled", "failed"])
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? mapInterviewScheduleRow(data) : null;
    },

    async loadById(scheduleId) {
      const { data, error } = await admin
        .from("interview_schedules")
        .select("*")
        .eq("id", scheduleId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? mapInterviewScheduleRow(data) : null;
    },

    async insertPending(input) {
      const { data, error } = await admin
        .from("interview_schedules")
        .insert({
          application_id: input.applicationId,
          job_id: input.jobId,
          recruiter_id: input.recruiterId,
          seeker_id: input.seekerId,
          scheduled_by: input.scheduledBy,
          start_at: input.startAt,
          end_at: input.endAt,
          timezone: input.timezone,
          status: "pending",
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return mapInterviewScheduleRow(data!);
    },

    async tryAcquireLease(id, untilIso) {
      const loaded = await this.loadById(id);
      if (!loaded) return false;
      const held = loaded.lease_until !== null && Date.parse(loaded.lease_until) > Date.now();
      if (held) return false;
      type LeaseUpdate = {
        select: (cols: string) => {
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
            error: { message: string } | null;
          }>;
        };
      };
      const leaseQuery = admin
        .from("interview_schedules")
        .update({ lease_until: untilIso })
        .eq("id", id) as unknown as LeaseUpdate;
      const { data, error } = await leaseQuery.select("id").maybeSingle();
      if (error) return false;
      return Boolean(data);
    },

    async releaseLease(id) {
      await admin.from("interview_schedules").update({ lease_until: null }).eq("id", id);
    },

    async save(id, patch) {
      const row = writeToDb(patch);
      if (Object.keys(row).length === 0) return;
      const { error } = await admin.from("interview_schedules").update(row).eq("id", id);
      if (error) throw new Error(error.message);
    },

    async updateTimes(scheduleId, input) {
      const { error } = await admin
        .from("interview_schedules")
        .update({
          start_at: input.startAt,
          end_at: input.endAt,
          timezone: input.timezone,
          reschedule_count: input.rescheduleCount,
        })
        .eq("id", scheduleId);
      if (error) throw new Error(error.message);
    },
  };
}
