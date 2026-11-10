import { supabase } from "@/integrations/supabase/client";
import type { ApplicationStatus } from "@/components/status/status";
import { nextApplicationStatuses } from "@/lib/hirehub";

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

export class NotifyApplicationStatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotifyApplicationStatusError";
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Matches Edge Function + DB trigger dedupe so retries do not duplicate rows. */
export function applicationStatusDedupeKey(applicationId: string, status: ApplicationStatus): string {
  return `application_status:${applicationId}:${status}`;
}

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
  const applicationId = body["applicationId"];
  const status = body["status"];
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

/** Response shape when the edge function records an in-app notification. */
export function buildDeliveredNotificationResult(notification: {
  applicationId: string;
  status: ApplicationStatus;
  seekerId: string;
  jobId: string;
  jobTitle: string;
}): NotifyApplicationStatusResult {
  return {
    ok: true,
    delivered: true,
    deliveryStatus: "delivered",
    reason: "In-app notification recorded for the seeker",
    notification,
  };
}

/**
 * Invoke deployed notify-application-status after a successful status UPDATE.
 * Throws when the Edge Function invoke fails or delivery is not confirmed —
 * callers must not toast success in that case.
 */
export async function requestApplicationStatusNotification(
  applicationId: string,
  status: ApplicationStatus,
): Promise<NotifyApplicationStatusResult> {
  const parsed = parseNotifyApplicationStatusBody({ applicationId, status });
  if (!parsed.ok) {
    throw new NotifyApplicationStatusError(parsed.error);
  }

  const { data, error } = await supabase.functions.invoke(NOTIFY_APPLICATION_STATUS_FN, {
    body: parsed.value,
  });

  if (error) {
    throw new NotifyApplicationStatusError(
      error.message || "Could not create the seeker notification",
    );
  }

  const result = data as NotifyApplicationStatusResult | null;
  if (!result?.ok || !result.delivered) {
    throw new NotifyApplicationStatusError(
      result?.reason || "Could not create the seeker notification",
    );
  }

  return result;
}

/**
 * Persist a pipeline transition, then require in-app notification delivery.
 * Used by recruiter and admin UIs so both paths share the same Edge Function.
 */
export async function updateApplicationStatusWithNotification(input: {
  applicationId: string;
  from: ApplicationStatus;
  status: ApplicationStatus;
}): Promise<NotifyApplicationStatusResult> {
  const allowed = nextApplicationStatuses(input.from) ?? [];
  if (!allowed.includes(input.status)) {
    throw new Error(`Cannot move from ${input.from} to ${input.status}`);
  }

  const { data, error } = await supabase
    .from("applications")
    .update({ status: input.status })
    .eq("id", input.applicationId)
    .eq("status", input.from)
    .select("id");

  if (error) throw error;
  if (!data?.length) {
    throw new Error("Status was already changed. Refresh and try again.");
  }

  return requestApplicationStatusNotification(input.applicationId, input.status);
}
