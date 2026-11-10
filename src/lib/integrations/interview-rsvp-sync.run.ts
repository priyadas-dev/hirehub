/**
 * Production wiring for RSVP poller (D1 runner).
 * Uses service-role Supabase + existing getInterviewEvent (single Google codepath).
 */

import { getInterviewEvent, resolveGoogleCalendarConfig } from "@/lib/integrations/google-calendar";
import { createInterviewScheduleRepository } from "@/lib/integrations/interview-schedule-persistence";
import {
  INTERVIEW_RSVP_SYNC_DEFAULT_BATCH,
  runInterviewRsvpSyncBatch,
  type RsvpSyncBatchResult,
  type RsvpSyncRow,
} from "@/lib/integrations/interview-rsvp-sync";
import { isSupabaseServiceRoleConfigured } from "@/lib/oauth-signup-role";

export async function runInterviewRsvpSyncFromEnv(options?: {
  batchSize?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<RsvpSyncBatchResult> {
  const env = options?.env ?? process.env;
  if (!isSupabaseServiceRoleConfigured(env)) {
    return {
      ok: false,
      scanned: 0,
      updated: 0,
      cancelled: 0,
      unchanged: 0,
      errors: 1,
      code: "service_role_not_configured",
    };
  }

  if (!resolveGoogleCalendarConfig(env)) {
    return {
      ok: false,
      scanned: 0,
      updated: 0,
      cancelled: 0,
      unchanged: 0,
      errors: 1,
      code: "google_not_configured",
    };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const repository = createInterviewScheduleRepository(supabaseAdmin as never);

  return runInterviewRsvpSyncBatch({
    batchSize: options?.batchSize ?? INTERVIEW_RSVP_SYNC_DEFAULT_BATCH,
    google: {
      getInterviewEvent: (input) => getInterviewEvent(input, { env }),
    },
    store: {
      listScheduledForRsvpSync: async (limit) => {
        const rows = await repository.listScheduledForRsvpSync(limit);
        return rows
          .filter((r) => Boolean(r.google_event_id && r.invited_at && r.status === "scheduled"))
          .map(
            (r): RsvpSyncRow => ({
              id: r.id,
              status: r.status,
              google_event_id: r.google_event_id as string,
              invited_at: r.invited_at as string,
              recruiter_id: r.recruiter_id,
              seeker_id: r.seeker_id,
              recruiter_response: r.recruiter_response,
              seeker_response: r.seeker_response,
              html_link: r.html_link,
              etag: r.etag,
              last_synced_at: r.last_synced_at,
              lease_until: r.lease_until,
            }),
          );
      },
      tryAcquireLease: (id, until) => repository.tryAcquireLease(id, until),
      releaseLease: (id) => repository.releaseLease(id),
      save: (id, patch) => repository.save(id, patch),
      loadAttendeeEmails: (recruiterId, seekerId) =>
        repository.loadAttendeeEmailsForSync(recruiterId, seekerId),
    },
  });
}

/** Timing-safe compare for cron shared secret. */
export function cronSecretsEqual(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export const INTERVIEW_RSVP_CRON_PATH = "/api/cron/sync-interview-rsvp";

/**
 * HTTP entry for Edge → app server-delegate.
 * POST only; `x-hirehub-cron-secret` must match `CRON_SECRET` (≥16 chars).
 * Counts-only JSON. Rejects identity body fields.
 */
export async function handleInterviewRsvpCronRequest(request: Request): Promise<Response> {
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  if (request.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  if (cronSecret.length < 16) {
    return json(500, { ok: false, error: "Server configuration error" });
  }

  const provided = request.headers.get("x-hirehub-cron-secret") ?? "";
  if (!cronSecretsEqual(provided, cronSecret)) {
    return json(401, { ok: false, error: "Unauthorized" });
  }

  try {
    const raw = await request.json().catch(() => ({}));
    if (raw && typeof raw === "object") {
      const body = raw as Record<string, unknown>;
      if ("userId" in body || "role" in body || "email" in body) {
        return json(400, {
          ok: false,
          error: "Identity fields are not accepted in the request body",
        });
      }
    }
  } catch {
    /* empty body ok */
  }

  const result = await runInterviewRsvpSyncFromEnv();
  const status = result.ok || result.scanned > 0 ? 200 : result.code === "google_not_configured" || result.code === "google_auth_revoked" || result.code === "google_auth_failed" || result.code === "service_role_not_configured" ? 503 : 200;

  return json(status, {
    ok: result.ok,
    scanned: result.scanned,
    updated: result.updated,
    cancelled: result.cancelled,
    unchanged: result.unchanged,
    errors: result.errors,
    ...(result.code ? { code: result.code } : {}),
  });
}
