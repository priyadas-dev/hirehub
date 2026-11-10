/**
 * Inbound Google Calendar RSVP sync (Assessment 3 Track 1 — Phase D1).
 *
 * Polling only — no events.watch / push. Service-role writes via injectable store.
 * First ship scope: status='scheduled' AND invited_at set AND google_event_id set.
 * Pending Meet rows are intentionally out of scope for v1 RSVP batches.
 *
 * Idempotency (locked): when RSVP/status are unchanged, still bump `last_synced_at`
 * so the `interview_schedules_active_sync_idx` queue rotates. Soft Google errors
 * (rate-limit / unavailable) do not mutate responses/status and do not bump
 * last_synced_at (row stays near the front for retry after cooldown elsewhere).
 */

import type {
  GoogleFailure,
  InterviewEventSuccess,
  InterviewResponse,
} from "@/lib/integrations/google-calendar";
import type {
  InterviewLifecycleStatus,
  InterviewRowWrite,
} from "@/lib/integrations/interview-orchestrator";

export const INTERVIEW_RSVP_SYNC_DEFAULT_BATCH = 25;
export const INTERVIEW_RSVP_SYNC_MAX_BATCH = 50;
export const INTERVIEW_RSVP_SYNC_LEASE_MS = 60_000;

export type RsvpSyncRow = {
  id: string;
  status: InterviewLifecycleStatus;
  google_event_id: string;
  invited_at: string;
  recruiter_id: string;
  seeker_id: string;
  recruiter_response: InterviewResponse;
  seeker_response: InterviewResponse;
  html_link: string | null;
  etag: string | null;
  last_synced_at: string | null;
  lease_until: string | null;
};

export type RsvpSyncBatchResult = {
  ok: boolean;
  scanned: number;
  updated: number;
  cancelled: number;
  unchanged: number;
  errors: number;
  /** Present when the whole run cannot auth / is misconfigured. */
  code?: string;
};

export type RsvpSyncGoogleClient = {
  getInterviewEvent: (input: {
    eventId: string;
    recruiterEmail?: string;
    seekerEmail?: string;
  }) => Promise<InterviewEventSuccess | GoogleFailure>;
};

export type RsvpSyncStore = {
  listScheduledForRsvpSync: (limit: number) => Promise<RsvpSyncRow[]>;
  tryAcquireLease: (id: string, untilIso: string) => Promise<boolean>;
  releaseLease: (id: string) => Promise<void>;
  save: (id: string, patch: InterviewRowWrite) => Promise<void>;
  /** Resolve emails for Google attendee matching. Never logged by the sync core. */
  loadAttendeeEmails: (
    recruiterId: string,
    seekerId: string,
  ) => Promise<{ recruiterEmail: string; seekerEmail: string } | null>;
};

export type RsvpSyncDeps = {
  google: RsvpSyncGoogleClient;
  store: RsvpSyncStore;
  now?: () => Date;
  leaseMs?: number;
  batchSize?: number;
};

export type RsvpSyncPlan =
  | { kind: "unchanged"; bumpLastSyncedAt: true }
  | {
      kind: "update";
      patch: InterviewRowWrite;
      cancelled: boolean;
    }
  | { kind: "soft_error"; code: string; retryable: boolean }
  | { kind: "fatal_auth"; code: string };

const AUTH_FATAL = new Set([
  "google_not_configured",
  "google_auth_revoked",
  "google_auth_failed",
]);

const SOFT_ERROR = new Set([
  "google_rate_limited",
  "google_unavailable",
  "google_network_error",
]);

function clampBatchSize(n: number | undefined): number {
  const raw = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : INTERVIEW_RSVP_SYNC_DEFAULT_BATCH;
  return Math.min(INTERVIEW_RSVP_SYNC_MAX_BATCH, Math.max(1, raw));
}

/**
 * Pure decision: map a Google get result onto a HireHub write plan.
 * Does not invent Meet links. Cancel maps calendar cancelled → status cancelled.
 */
export function planRsvpSyncFromGoogleResult(input: {
  row: Pick<
    RsvpSyncRow,
    "recruiter_response" | "seeker_response" | "html_link" | "etag" | "status"
  >;
  result: InterviewEventSuccess | GoogleFailure;
  nowIso: string;
}): RsvpSyncPlan {
  const { row, result, nowIso } = input;
  if (!result.ok) {
    if (AUTH_FATAL.has(result.reason)) {
      return { kind: "fatal_auth", code: result.reason };
    }
    if (SOFT_ERROR.has(result.reason) || result.retryable) {
      return {
        kind: "soft_error",
        code: result.reason,
        retryable: result.retryable,
      };
    }
    // Non-retryable hard failures (not found / gone): treat as soft for the row
    // so we do not invent cancels without calendarStatus=cancelled.
    return { kind: "soft_error", code: result.reason, retryable: false };
  }

  const event = result.event;
  if (event.calendarStatus === "cancelled") {
    const patch: InterviewRowWrite = {
      status: "cancelled",
      lastSyncedAt: nowIso,
    };
    if (event.htmlLink) patch.htmlLink = event.htmlLink;
    if (event.etag) patch.etag = event.etag;
    if (event.recruiterResponse) patch.recruiterResponse = event.recruiterResponse;
    if (event.seekerResponse) patch.seekerResponse = event.seekerResponse;
    return { kind: "update", patch, cancelled: true };
  }

  const nextRecruiter = event.recruiterResponse ?? row.recruiter_response;
  const nextSeeker = event.seekerResponse ?? row.seeker_response;
  const nextHtml = event.htmlLink ?? row.html_link;
  const nextEtag = event.etag ?? row.etag;

  const responseChanged =
    nextRecruiter !== row.recruiter_response || nextSeeker !== row.seeker_response;
  const metaChanged = nextHtml !== row.html_link || nextEtag !== row.etag;

  if (!responseChanged && !metaChanged) {
    return { kind: "unchanged", bumpLastSyncedAt: true };
  }

  const patch: InterviewRowWrite = {
    lastSyncedAt: nowIso,
    recruiterResponse: nextRecruiter,
    seekerResponse: nextSeeker,
  };
  if (nextHtml !== undefined) patch.htmlLink = nextHtml;
  if (nextEtag !== undefined) patch.etag = nextEtag;
  return { kind: "update", patch, cancelled: false };
}

/** Run one RSVP polling batch. Counts-only result — never tokens/emails/bodies. */
export async function runInterviewRsvpSyncBatch(
  deps: RsvpSyncDeps,
): Promise<RsvpSyncBatchResult> {
  const now = deps.now ?? (() => new Date());
  const leaseMs = deps.leaseMs ?? INTERVIEW_RSVP_SYNC_LEASE_MS;
  const limit = clampBatchSize(deps.batchSize);

  let rows: RsvpSyncRow[];
  try {
    rows = await deps.store.listScheduledForRsvpSync(limit);
  } catch {
    return { ok: false, scanned: 0, updated: 0, cancelled: 0, unchanged: 0, errors: 1, code: "list_failed" };
  }

  const summary: RsvpSyncBatchResult = {
    ok: true,
    scanned: rows.length,
    updated: 0,
    cancelled: 0,
    unchanged: 0,
    errors: 0,
  };

  for (const row of rows) {
    if (!row.google_event_id || !row.invited_at || row.status !== "scheduled") {
      summary.errors += 1;
      continue;
    }

    const untilIso = new Date(now().getTime() + leaseMs).toISOString();
    const leased = await deps.store.tryAcquireLease(row.id, untilIso);
    if (!leased) {
      summary.errors += 1;
      continue;
    }

    try {
      const emails = await deps.store.loadAttendeeEmails(row.recruiter_id, row.seeker_id);
      if (!emails?.recruiterEmail || !emails.seekerEmail) {
        summary.errors += 1;
        continue;
      }

      const googleResult = await deps.google.getInterviewEvent({
        eventId: row.google_event_id,
        recruiterEmail: emails.recruiterEmail,
        seekerEmail: emails.seekerEmail,
      });

      const plan = planRsvpSyncFromGoogleResult({
        row,
        result: googleResult,
        nowIso: now().toISOString(),
      });

      if (plan.kind === "fatal_auth") {
        summary.ok = false;
        summary.code = plan.code;
        summary.errors += 1;
        return summary;
      }

      if (plan.kind === "soft_error") {
        summary.errors += 1;
        continue;
      }

      if (plan.kind === "unchanged") {
        await deps.store.save(row.id, { lastSyncedAt: now().toISOString() });
        summary.unchanged += 1;
        continue;
      }

      await deps.store.save(row.id, plan.patch);
      if (plan.cancelled) summary.cancelled += 1;
      else summary.updated += 1;
    } catch {
      summary.errors += 1;
    } finally {
      await deps.store.releaseLease(row.id);
    }
  }

  return summary;
}
