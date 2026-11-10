import type { ApplicationStatus } from "@/components/status/status";
import { isAuthorizedApplicationNotifier } from "@/lib/notify-application-status";
import {
  buildInterviewAttendees,
  DEFAULT_INTERVIEW_TIMEZONE,
  type InterviewAttendee,
} from "@/lib/integrations/google-calendar";

export const INTERVIEW_MIN_LEAD_MS = 15 * 60 * 1000;
export const INTERVIEW_MIN_DURATION_MS = 15 * 60 * 1000;
export const INTERVIEW_MAX_DURATION_MS = 4 * 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const IDENTITY_KEYS = ["userId", "role", "email", "recruiterId", "seekerId"] as const;

export type InterviewScheduleApplicationStatus = Extract<
  ApplicationStatus,
  "shortlisted" | "interview"
>;

const SCHEDULABLE_STATUSES: InterviewScheduleApplicationStatus[] = ["shortlisted", "interview"];

/** Reject identity smuggling in JSON bodies (same rule as notify-application-status). */
export function rejectInterviewIdentityFields(
  raw: unknown,
): { ok: true } | { ok: false; code: "identity_fields_forbidden" } {
  if (!raw || typeof raw !== "object") return { ok: true };
  const body = raw as Record<string, unknown>;
  for (const key of IDENTITY_KEYS) {
    if (key in body) return { ok: false, code: "identity_fields_forbidden" };
  }
  return { ok: true };
}

export function isSchedulableApplicationStatus(
  status: ApplicationStatus,
): status is InterviewScheduleApplicationStatus {
  return SCHEDULABLE_STATUSES.includes(status as InterviewScheduleApplicationStatus);
}

/**
 * Recruiter who owns the job or admin may schedule, retry, reschedule, and cancel.
 * Role and recruiter id come from the database — never the request body.
 */
export function isAuthorizedInterviewManager(args: {
  callerId: string;
  callerRole: string | null | undefined;
  jobRecruiterId: string;
}): boolean {
  return isAuthorizedApplicationNotifier({
    callerId: args.callerId,
    callerRole: args.callerRole,
    jobRecruiterId: args.jobRecruiterId,
  });
}

/** Same generic denial for missing rows and unauthorized callers. */
export function interviewAccessDeniedCode(): "not_found" {
  return "not_found";
}

export type ValidateInterviewWindowResult =
  | { ok: true; timezone: string }
  | {
      ok: false;
      code: "invalid_time" | "invalid_time_range" | "invalid_timezone" | "start_too_soon";
    };

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function validateInterviewWindow(input: {
  startAt: string;
  endAt: string;
  timezone?: string;
  nowMs?: number;
}): ValidateInterviewWindowResult {
  const tz = input.timezone?.trim() || DEFAULT_INTERVIEW_TIMEZONE;
  if (!isValidTimezone(tz)) return { ok: false, code: "invalid_timezone" };
  const start = Date.parse(input.startAt);
  const end = Date.parse(input.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { ok: false, code: "invalid_time" };
  }
  if (end <= start) return { ok: false, code: "invalid_time_range" };
  const duration = end - start;
  if (duration < INTERVIEW_MIN_DURATION_MS || duration > INTERVIEW_MAX_DURATION_MS) {
    return { ok: false, code: "invalid_time_range" };
  }
  const now = input.nowMs ?? Date.now();
  if (start < now + INTERVIEW_MIN_LEAD_MS) return { ok: false, code: "start_too_soon" };
  return { ok: true, timezone: tz };
}

export function validateInterviewAttendees(
  recruiter: InterviewAttendee,
  seeker: InterviewAttendee,
):
  | { ok: true; recruiter: InterviewAttendee; seeker: InterviewAttendee }
  | {
      ok: false;
      code: "recruiter_email_invalid" | "seeker_email_invalid" | "attendee_emails_must_differ";
    } {
  const built = buildInterviewAttendees(recruiter, seeker);
  if (!built.ok) return { ok: false, code: built.reason };
  const recruiterAtt = built.attendees[0]!;
  const seekerAtt = built.attendees[1]!;
  return {
    ok: true,
    recruiter: {
      email: recruiterAtt.email,
      ...(recruiterAtt.displayName ? { displayName: recruiterAtt.displayName } : {}),
    },
    seeker: {
      email: seekerAtt.email,
      ...(seekerAtt.displayName ? { displayName: seekerAtt.displayName } : {}),
    },
  };
}

export function isValidInterviewScheduleUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}
