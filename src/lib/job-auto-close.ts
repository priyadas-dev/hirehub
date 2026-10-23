/**
 * Expired-job auto-close — pure helpers mirroring PROPOSED_0013 / 0014 + Edge Function.
 *
 * Business rule (same calendar as deadline RLS):
 *   close when status = 'approved'
 *   AND application_deadline IS NOT NULL
 *   AND application_deadline < Asia/Dhaka today
 *
 * After PROPOSED_0014, RPC also sets closed_reason = 'expired_deadline'.
 */

import { businessCalendarDate, isApplicationDeadlinePassed } from "@/lib/job-fields";

export const CLOSE_EXPIRED_JOBS_FN = "close-expired-jobs" as const;
export const CLOSE_EXPIRED_JOBS_RPC = "close_expired_approved_jobs" as const;

export const JOB_AUTO_CLOSE_DELIVERY = {
  clientMayInvoke: false,
  deliveryPath: "edge_function_cron_or_rpc" as const,
  rpcName: CLOSE_EXPIRED_JOBS_RPC,
  edgeFunctionName: CLOSE_EXPIRED_JOBS_FN,
  timezone: "Asia/Dhaka",
  protectPath: "service_role_jwt_expired_deadline" as const,
  closedReasonAfter0014: "expired_deadline" as const,
} as const;

/**
 * Distinguishing expiry closes requires PROPOSED_0014 (`closed_reason`).
 * Until that migration is applied, schemaCanDistinguishExpiryClose is false at runtime.
 */
export const JOB_CLOSED_REASON_SUPPORT = {
  proposedMigration: "PROPOSED_0014_job_closed_reason.sql" as const,
  /** Code supports distinction once the column exists; live DB may not have it yet. */
  codeSupportsClosedReason: true,
  unsafeHeuristic: "closed_and_deadline_in_past",
} as const;

export type AutoCloseJobCandidate = {
  id: string;
  status: string;
  application_deadline: string | null;
  recruiter_id?: string;
  title?: string;
};

export function isEligibleForAutoClose(
  job: Pick<AutoCloseJobCandidate, "status" | "application_deadline">,
  now = new Date(),
): boolean {
  if (job.status !== "approved") return false;
  return isApplicationDeadlinePassed(job.application_deadline, now);
}

export function isServiceRoleExpiryCloseAllowed(args: {
  jwtRole: string | null | undefined;
  oldStatus: string;
  newStatus: string;
  applicationDeadline: string | null | undefined;
  now?: Date;
}): boolean {
  if (args.jwtRole !== "service_role") return false;
  if (args.oldStatus !== "approved" || args.newStatus !== "closed") return false;
  return isApplicationDeadlinePassed(args.applicationDeadline, args.now ?? new Date());
}

export function selectJobsToAutoClose(
  jobs: AutoCloseJobCandidate[],
  now = new Date(),
): AutoCloseJobCandidate[] {
  return jobs.filter((j) => isEligibleForAutoClose(j, now));
}

export function autoCloseDhakaToday(now = new Date()): string {
  return businessCalendarDate(now);
}

export function isValidCronSecret(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  if (provided.length < 16 || expected.length < 16) return false;
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export function buildCloseExpiredJobsResult(closedCount: number): {
  ok: true;
  closedCount: number;
  dhakaDate: string;
} {
  return {
    ok: true,
    closedCount,
    dhakaDate: autoCloseDhakaToday(),
  };
}
