import { supabase } from "@/integrations/supabase/client";
import type { ApplicationStatus } from "@/components/status/status";

export const NOTIFY_APPLICATION_STATUS_FN = "notify-application-status" as const;

export const APPLICATION_STATUSES = [
  "applied",
  "shortlisted",
  "interview",
  "hired",
  "rejected",
] as const satisfies readonly ApplicationStatus[];

export type NotifyApplicationStatusBody = {
  applicationId: string;
  status: ApplicationStatus;
};

export type NotifyDeliveryStatus = "pending_provider" | "delivered" | "skipped";

export type NotifyApplicationStatusResult = {
  ok: boolean;
  delivered: boolean;
  deliveryStatus: NotifyDeliveryStatus;
  reason: string;
  notification?: {
    applicationId: string;
    status: ApplicationStatus;
    seekerId: string;
    jobId: string;
    jobTitle: string;
  };
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Validate request body shape only — never trust identity fields from the client. */
export function parseNotifyApplicationStatusBody(
  raw: unknown,
): { ok: true; value: NotifyApplicationStatusBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Request body must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;
  if ("userId" in body || "role" in body || "email" in body || "recruiterId" in body) {
    return {
      ok: false,
      error: "Identity fields are not accepted in the request body",
    };
  }
  const applicationId = body.applicationId;
  const status = body.status;
  if (typeof applicationId !== "string" || !UUID_RE.test(applicationId)) {
    return { ok: false, error: "applicationId must be a valid UUID" };
  }
  if (typeof status !== "string" || !APPLICATION_STATUSES.includes(status as ApplicationStatus)) {
    return { ok: false, error: "status must be a valid application status" };
  }
  return { ok: true, value: { applicationId, status: status as ApplicationStatus } };
}

/**
 * Caller may notify only when they own the job or are an admin.
 * Role and recruiter id must come from the database / JWT — never the request body.
 */
export function isAuthorizedApplicationNotifier(args: {
  callerId: string;
  callerRole: string | null | undefined;
  jobRecruiterId: string;
}): boolean {
  if (!args.callerId || !args.jobRecruiterId) return false;
  if (args.callerRole === "admin") return true;
  return args.callerId === args.jobRecruiterId;
}

/** Response when auth succeeds but no email provider / notifications table exists. */
export function buildPendingProviderResult(notification: {
  applicationId: string;
  status: ApplicationStatus;
  seekerId: string;
  jobId: string;
  jobTitle: string;
}): NotifyApplicationStatusResult {
  return {
    ok: true,
    delivered: false,
    deliveryStatus: "pending_provider",
    reason:
      "Notification authorized, but no email provider or notifications table is configured yet",
    notification,
  };
}

/**
 * Best-effort invoke after a successful status UPDATE.
 * Failures are swallowed by the caller so they never undo the status change.
 */
export async function requestApplicationStatusNotification(
  applicationId: string,
  status: ApplicationStatus,
): Promise<NotifyApplicationStatusResult | null> {
  const parsed = parseNotifyApplicationStatusBody({ applicationId, status });
  if (!parsed.ok) return null;

  const { data, error } = await supabase.functions.invoke(NOTIFY_APPLICATION_STATUS_FN, {
    body: parsed.value,
  });

  if (error) {
    console.warn("[notify-application-status] invoke failed", error.message);
    return null;
  }

  return data as NotifyApplicationStatusResult;
}
