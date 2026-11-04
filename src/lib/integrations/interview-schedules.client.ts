import { supabase } from "@/integrations/supabase/client";
import { isMissingSchemaError } from "@/lib/hirehub-storage";
import type { InterviewResponse } from "@/lib/integrations/google-calendar";
import type { InterviewLifecycleStatus } from "@/lib/integrations/interview-orchestrator";

export type InterviewScheduleView = {
  id: string;
  application_id: string;
  start_at: string;
  end_at: string;
  timezone: string;
  status: InterviewLifecycleStatus;
  meet_link: string | null;
  invited_at: string | null;
  conference_status: string;
  conference_attempt: number;
  failure_reason: string | null;
  recruiter_response: InterviewResponse;
  seeker_response: InterviewResponse;
  html_link: string | null;
};

type UntypedSupabase = {
  from: (table: string) => ReturnType<typeof supabase.from>;
};

const OPEN_STATUSES: InterviewLifecycleStatus[] = ["pending", "scheduled", "failed"];

function mapRow(raw: Record<string, unknown>): InterviewScheduleView {
  return {
    id: String(raw["id"] ?? ""),
    application_id: String(raw["application_id"] ?? ""),
    start_at: String(raw["start_at"] ?? ""),
    end_at: String(raw["end_at"] ?? ""),
    timezone: String(raw["timezone"] ?? "Asia/Dhaka"),
    status: String(raw["status"] ?? "pending") as InterviewLifecycleStatus,
    meet_link: raw["meet_link"] ? String(raw["meet_link"]) : null,
    invited_at: raw["invited_at"] ? String(raw["invited_at"]) : null,
    conference_status: String(raw["conference_status"] ?? "pending"),
    conference_attempt: Number(raw["conference_attempt"] ?? 1),
    failure_reason: raw["failure_reason"] ? String(raw["failure_reason"]) : null,
    recruiter_response: (String(raw["recruiter_response"] ?? "needsAction") ||
      "needsAction") as InterviewResponse,
    seeker_response: (String(raw["seeker_response"] ?? "needsAction") ||
      "needsAction") as InterviewResponse,
    html_link: raw["html_link"] ? String(raw["html_link"]) : null,
  };
}

const SCHEDULE_SELECT =
  "id,application_id,start_at,end_at,timezone,status,meet_link,invited_at,conference_status,conference_attempt,failure_reason,recruiter_response,seeker_response,html_link";

/** Open row for recruiter UI (pending, scheduled, or failed). */
export async function fetchOpenInterviewScheduleForApplication(
  applicationId: string,
): Promise<InterviewScheduleView | null> {
  const client = supabase as unknown as UntypedSupabase;
  const { data, error } = await client
    .from("interview_schedules")
    .select(SCHEDULE_SELECT)
    .eq("application_id", applicationId)
    .in("status", OPEN_STATUSES)
    .maybeSingle();

  if (error) {
    if (isMissingSchemaError(error.message)) return null;
    throw error;
  }
  if (!data || typeof data !== "object") return null;
  return mapRow(data as Record<string, unknown>);
}

/**
 * Seeker-visible scheduled interview only (invited + real Meet link).
 * RLS still applies; extra filters match product rules.
 */
export async function fetchSeekerScheduledInterview(
  applicationId: string,
): Promise<InterviewScheduleView | null> {
  const client = supabase as unknown as UntypedSupabase;
  const { data, error } = await client
    .from("interview_schedules")
    .select(SCHEDULE_SELECT)
    .eq("application_id", applicationId)
    .eq("status", "scheduled")
    .not("meet_link", "is", null)
    .not("invited_at", "is", null)
    .maybeSingle();

  if (error) {
    if (isMissingSchemaError(error.message)) return null;
    throw error;
  }
  if (!data || typeof data !== "object") return null;
  return mapRow(data as Record<string, unknown>);
}
