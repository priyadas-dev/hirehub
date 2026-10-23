/**
 * Recruiter expiry-only reopen helpers (mirrors PROPOSED_0014 RPC rules).
 * Editing a deadline alone never reopens — reopen is an explicit action.
 */

import { isDeadlineOnOrAfterToday, isRealCalendarDate } from "@/lib/job-fields";

export const JOB_CLOSED_REASONS = ["expired_deadline", "recruiter", "admin"] as const;
export type JobClosedReason = (typeof JOB_CLOSED_REASONS)[number];

export const RECRUITER_REOPEN_EXPIRED_JOB_RPC = "recruiter_reopen_expired_job" as const;

export type ExpiryReopenJob = {
  id: string;
  status: string;
  recruiter_id: string;
  closed_reason?: string | null;
  application_deadline?: string | null;
};

/** True when this closed job is eligible for the recruiter expiry-reopen flow. */
export function isExpiryAutoClosedJob(
  job: Pick<ExpiryReopenJob, "status" | "closed_reason">,
): boolean {
  return job.status === "closed" && job.closed_reason === "expired_deadline";
}

export function canRecruiterReopenExpiredJob(args: {
  job: ExpiryReopenJob;
  callerId: string;
  newDeadline: string;
  now?: Date;
}): { ok: true } | { ok: false; reason: string } {
  if (!args.callerId || args.job.recruiter_id !== args.callerId) {
    return { ok: false, reason: "Not your job" };
  }
  if (args.job.status !== "closed") {
    return { ok: false, reason: "Only closed jobs can be reopened through this flow" };
  }
  if (args.job.closed_reason !== "expired_deadline") {
    return {
      ok: false,
      reason:
        "Only jobs closed automatically for an expired deadline can be reopened by the recruiter",
    };
  }
  if (!isRealCalendarDate(args.newDeadline)) {
    return { ok: false, reason: "Enter a valid application deadline" };
  }
  if (!isDeadlineOnOrAfterToday(args.newDeadline, args.now ?? new Date())) {
    return { ok: false, reason: "New deadline must be today or a future date" };
  }
  return { ok: true };
}

/** Manual close payloads — stamp reason; ignore if column not yet migrated. */
export function manualClosePayload(actor: "recruiter" | "admin"): {
  status: "closed";
  closed_reason: JobClosedReason;
} {
  return { status: "closed", closed_reason: actor };
}

export function adminReopenPayload(): { status: "approved"; closed_reason: null } {
  return { status: "approved", closed_reason: null };
}

export function isClosedReasonMissingError(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    (msg.includes("closed_reason") && (msg.includes("column") || msg.includes("schema")))
  );
}

export function isReopenRpcUnavailable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    msg.includes("recruiter_reopen_expired_job") ||
    msg.includes("could not find the function") ||
    msg.includes("schema cache")
  );
}
