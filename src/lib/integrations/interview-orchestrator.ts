/**
 * Interview scheduling orchestrator (Assessment 3 Phase 3, step 3.2).
 *
 * Pure of HTTP/auth/UI: Google Calendar calls and persistence are injected. Scheduling,
 * recruiter retry, and (later) the poller all call `advanceInterview` so every path
 * converges. Invitations go out only after a real hangoutLink exists.
 *
 * Retry ladder (one recruiter click = one rung, cap 3):
 *   1. Initial create (no attendees, sendUpdates=none).
 *   2. PATCH a new conference createRequest on the SAME event.
 *   3. Discard the never-invited event and recreate under a new deterministic event id.
 */
import {
  MAX_CONFERENCE_ATTEMPT,
  buildInvitedScheduleRowPatch,
  buildScheduleRowPatch,
  interviewEventIdFromScheduleId,
  type CancelInterviewResult,
  type ConferenceStatus,
  type DiscardUninvitedResult,
  type GoogleFailure,
  type InterviewAttendee,
  type InterviewEventInput,
  type InterviewEventSuccess,
  type InterviewResponse,
  type RescheduleInterviewInput,
  type InviteInterviewSuccess,
} from "@/lib/integrations/google-calendar";

export const INTERVIEW_LEASE_MS = 60_000;
export const MEET_POLL_ATTEMPTS = 3;
export const MEET_POLL_DELAY_MS = 2_000;

export type InterviewLifecycleStatus =
  "pending" | "scheduled" | "cancelled" | "failed" | "completed";

export type InterviewOrchestratorRow = {
  id: string;
  applicationId: string;
  jobTitle: string;
  companyName?: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
  status: InterviewLifecycleStatus;
  googleEventId: string | null;
  googleCalendarId: string | null;
  htmlLink: string | null;
  etag: string | null;
  meetLink: string | null;
  conferenceStatus: ConferenceStatus;
  conferenceAttempt: number;
  invitedAt: string | null;
  recruiter: InterviewAttendee;
  seeker: InterviewAttendee;
  notes?: string | null;
};

export type InterviewRowWrite = {
  status?: InterviewLifecycleStatus;
  googleEventId?: string | null;
  googleCalendarId?: string | null;
  htmlLink?: string | null;
  etag?: string | null;
  meetLink?: string | null;
  conferenceStatus?: ConferenceStatus;
  conferenceAttempt?: number;
  invitedAt?: string | null;
  recruiterResponse?: InterviewResponse;
  seekerResponse?: InterviewResponse;
  failureReason?: string | null;
  /** ISO timestamp written to `last_synced_at` by RSVP poller. */
  lastSyncedAt?: string | null;
};

export type InterviewOrchestratorStore = {
  tryAcquireLease(id: string, untilIso: string): Promise<boolean>;
  releaseLease(id: string): Promise<void>;
  save(id: string, patch: InterviewRowWrite): Promise<void>;
};

export type InterviewGoogleClient = {
  createInterviewEvent: (
    input: InterviewEventInput,
  ) => Promise<InterviewEventSuccess | GoogleFailure>;
  getInterviewEvent: (input: {
    eventId: string;
    recruiterEmail?: string;
    seekerEmail?: string;
  }) => Promise<InterviewEventSuccess | GoogleFailure>;
  sendInterviewInvitations: (input: {
    eventId: string;
    recruiter: InterviewAttendee;
    seeker: InterviewAttendee;
  }) => Promise<InviteInterviewSuccess | GoogleFailure>;
  requestConferenceRetry: (input: {
    eventId: string;
    scheduleId: string;
    attempt: number;
  }) => Promise<InterviewEventSuccess | GoogleFailure>;
  discardUninvitedEvent: (input: { eventId: string }) => Promise<DiscardUninvitedResult>;
  cancelInterviewEvent: (input: { eventId: string }) => Promise<CancelInterviewResult>;
  rescheduleInterviewEvent: (
    input: RescheduleInterviewInput,
  ) => Promise<InterviewEventSuccess | GoogleFailure>;
};

export type InterviewOrchestratorDeps = {
  google: InterviewGoogleClient;
  store: InterviewOrchestratorStore;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  pollAttempts?: number;
  pollDelayMs?: number;
  leaseMs?: number;
};

export type AdvanceInterviewIntent = "advance" | "retry_meet";

export type AdvanceInterviewResult =
  | { ok: true; state: "scheduled" | "awaiting_meet"; scheduleId: string }
  | { ok: false; code: string; retryable: boolean; scheduleId: string };

export type CancelInterviewFlowResult =
  | { ok: true; state: "cancelled"; notifiedAttendees: boolean; scheduleId: string }
  | { ok: false; code: string; retryable: boolean; scheduleId: string };

function isFullyScheduled(row: InterviewOrchestratorRow): boolean {
  return (
    row.status === "scheduled" &&
    Boolean(row.meetLink) &&
    Boolean(row.invitedAt) &&
    Boolean(row.googleEventId)
  );
}

function emails(row: InterviewOrchestratorRow) {
  return { recruiterEmail: row.recruiter.email, seekerEmail: row.seeker.email };
}

function createInput(row: InterviewOrchestratorRow, attempt: number): InterviewEventInput {
  const input: InterviewEventInput = {
    scheduleId: row.id,
    applicationId: row.applicationId,
    jobTitle: row.jobTitle,
    startAt: row.startAt,
    endAt: row.endAt,
    timezone: row.timezone,
    recruiter: row.recruiter,
    seeker: row.seeker,
    conferenceAttempt: attempt,
  };
  if (row.companyName) input.companyName = row.companyName;
  if (row.notes) input.notes = row.notes;
  return input;
}

function uninvitedWrite(
  google: InterviewEventSuccess,
  extra: InterviewRowWrite = {},
): InterviewRowWrite {
  const patch = buildScheduleRowPatch(google, { invitationsSent: false });
  return {
    status: patch.status,
    conferenceStatus: patch.conference_status,
    googleEventId: patch.google_event_id,
    googleCalendarId: patch.google_calendar_id,
    htmlLink: patch.html_link,
    etag: patch.etag,
    failureReason: patch.failure_reason,
    ...(patch.recruiter_response ? { recruiterResponse: patch.recruiter_response } : {}),
    ...(patch.seeker_response ? { seekerResponse: patch.seeker_response } : {}),
    ...extra,
  };
}

function invitedWrite(invite: InviteInterviewSuccess, invitedAt: string): InterviewRowWrite {
  const patch = buildInvitedScheduleRowPatch(invite);
  const write: InterviewRowWrite = {
    status: "scheduled",
    conferenceStatus: "success",
    googleEventId: patch.google_event_id,
    googleCalendarId: patch.google_calendar_id,
    htmlLink: patch.html_link,
    etag: patch.etag,
    invitedAt,
    failureReason: null,
  };
  if (patch.meet_link) write.meetLink = patch.meet_link;
  if (patch.recruiter_response) write.recruiterResponse = patch.recruiter_response;
  if (patch.seeker_response) write.seekerResponse = patch.seeker_response;
  return write;
}

function applyLocal(
  row: InterviewOrchestratorRow,
  patch: InterviewRowWrite,
): InterviewOrchestratorRow {
  return {
    ...row,
    status: patch.status ?? row.status,
    googleEventId: patch.googleEventId === undefined ? row.googleEventId : patch.googleEventId,
    googleCalendarId:
      patch.googleCalendarId === undefined ? row.googleCalendarId : patch.googleCalendarId,
    htmlLink: patch.htmlLink === undefined ? row.htmlLink : patch.htmlLink,
    etag: patch.etag === undefined ? row.etag : patch.etag,
    meetLink: patch.meetLink === undefined ? row.meetLink : patch.meetLink,
    conferenceStatus: patch.conferenceStatus ?? row.conferenceStatus,
    conferenceAttempt: patch.conferenceAttempt ?? row.conferenceAttempt,
    invitedAt: patch.invitedAt === undefined ? row.invitedAt : patch.invitedAt,
  };
}

async function persist(
  store: InterviewOrchestratorStore,
  row: InterviewOrchestratorRow,
  patch: InterviewRowWrite,
): Promise<InterviewOrchestratorRow> {
  await store.save(row.id, patch);
  return applyLocal(row, patch);
}

async function persistGoogleFailure(
  store: InterviewOrchestratorStore,
  row: InterviewOrchestratorRow,
  error: GoogleFailure,
): Promise<AdvanceInterviewResult> {
  const retryable = error.retryable;
  await store.save(row.id, {
    status: "failed",
    failureReason: error.reason,
    conferenceStatus: row.conferenceStatus === "failure" ? "failure" : row.conferenceStatus,
  });
  return { ok: false, code: error.reason, retryable, scheduleId: row.id };
}

async function pollUntilResolved(
  row: InterviewOrchestratorRow,
  google: InterviewEventSuccess,
  deps: InterviewOrchestratorDeps,
): Promise<InterviewEventSuccess | GoogleFailure> {
  if (google.outcome !== "conference_pending") return google;
  const attempts = deps.pollAttempts ?? MEET_POLL_ATTEMPTS;
  const delay = deps.pollDelayMs ?? MEET_POLL_DELAY_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let current = google;
  for (let i = 0; i < attempts; i++) {
    await sleep(delay);
    const eventId = current.event.eventId;
    const next = await deps.google.getInterviewEvent({ eventId, ...emails(row) });
    if (!next.ok) return next;
    current = next;
    if (current.outcome !== "conference_pending") return current;
  }
  return current;
}

async function ensureEvent(
  row: InterviewOrchestratorRow,
  deps: InterviewOrchestratorDeps,
  attempt: number,
): Promise<
  { row: InterviewOrchestratorRow; google: InterviewEventSuccess } | AdvanceInterviewResult
> {
  const eventId = row.googleEventId;
  let google: InterviewEventSuccess | GoogleFailure;

  if (eventId) {
    google = await deps.google.getInterviewEvent({ eventId, ...emails(row) });
    if (
      !google.ok &&
      (google.reason === "google_event_not_found" || google.reason === "google_event_gone")
    ) {
      google = await deps.google.createInterviewEvent(createInput(row, attempt));
    }
  } else {
    google = await deps.google.createInterviewEvent(createInput(row, attempt));
  }

  if (!google.ok) return persistGoogleFailure(deps.store, row, google);
  if (google.event.calendarStatus === "cancelled") {
    const next = await persist(deps.store, row, {
      status: "failed",
      failureReason: "google_event_cancelled",
      googleEventId: google.event.eventId,
    });
    return { ok: false, code: "google_event_cancelled", retryable: false, scheduleId: next.id };
  }

  const saved = await persist(
    deps.store,
    row,
    uninvitedWrite(google, { conferenceAttempt: attempt }),
  );
  return { row: saved, google };
}

async function inviteIfReady(
  row: InterviewOrchestratorRow,
  google: InterviewEventSuccess,
  deps: InterviewOrchestratorDeps,
  nowIso: string,
): Promise<AdvanceInterviewResult> {
  if (google.outcome === "conference_failed") {
    await persist(deps.store, row, uninvitedWrite(google));
    return { ok: false, code: "meet_creation_failed", retryable: false, scheduleId: row.id };
  }
  if (google.outcome !== "conference_ready" || !google.event.meetLink) {
    await persist(deps.store, row, uninvitedWrite(google));
    return { ok: true, state: "awaiting_meet", scheduleId: row.id };
  }

  const eventId = google.event.eventId;
  const invite = await deps.google.sendInterviewInvitations({
    eventId,
    recruiter: row.recruiter,
    seeker: row.seeker,
  });
  if (!invite.ok) {
    await persist(deps.store, row, {
      status: "pending",
      conferenceStatus: "pending",
      googleEventId: eventId,
      googleCalendarId: google.calendarId,
      htmlLink: google.event.htmlLink,
      etag: google.event.etag,
      failureReason: invite.reason,
    });
    return {
      ok: false,
      code: invite.reason === "meet_not_ready" ? "invite_failed" : invite.reason,
      retryable: invite.retryable,
      scheduleId: row.id,
    };
  }

  await persist(deps.store, row, invitedWrite(invite, nowIso));
  return { ok: true, state: "scheduled", scheduleId: row.id };
}

/**
 * Advance an interview toward `scheduled`. Never sends invitations before a real Meet link.
 * Idempotent: a crash between the Google invite and the DB write reconciles on the next call
 * (`alreadyInvited`) and does not create a second event or a second invitation.
 */
export async function advanceInterview(
  row: InterviewOrchestratorRow,
  deps: InterviewOrchestratorDeps,
  options: { intent?: AdvanceInterviewIntent } = {},
): Promise<AdvanceInterviewResult> {
  const intent = options.intent ?? "advance";
  const now = deps.now ?? (() => new Date());
  const leaseMs = deps.leaseMs ?? INTERVIEW_LEASE_MS;
  const scheduleId = row.id;

  if (row.status === "cancelled" || row.status === "completed") {
    return { ok: false, code: "interview_not_advanceable", retryable: false, scheduleId };
  }
  if (isFullyScheduled(row)) {
    return { ok: true, state: "scheduled", scheduleId };
  }

  const leased = await deps.store.tryAcquireLease(
    scheduleId,
    new Date(now().getTime() + leaseMs).toISOString(),
  );
  if (!leased) return { ok: false, code: "in_progress", retryable: true, scheduleId };

  let current = row;
  try {
    if (intent === "retry_meet" && current.status === "failed") {
      if (current.conferenceAttempt >= MAX_CONFERENCE_ATTEMPT && current.googleEventId) {
        return { ok: false, code: "meet_attempts_exhausted", retryable: false, scheduleId };
      }

      if (current.googleEventId && current.conferenceAttempt === 1) {
        const retried = await deps.google.requestConferenceRetry({
          eventId: current.googleEventId,
          scheduleId: current.id,
          attempt: 2,
        });
        if (!retried.ok) return persistGoogleFailure(deps.store, current, retried);
        current = await persist(
          deps.store,
          current,
          uninvitedWrite(retried, { conferenceAttempt: 2 }),
        );
        const resolved = await pollUntilResolved(current, retried, deps);
        if (!resolved.ok) return persistGoogleFailure(deps.store, current, resolved);
        return inviteIfReady(current, resolved, deps, now().toISOString());
      }

      if (current.googleEventId && current.conferenceAttempt >= 2) {
        const discarded = await deps.google.discardUninvitedEvent({
          eventId: current.googleEventId,
        });
        if (!discarded.ok) return persistGoogleFailure(deps.store, current, discarded);
        const created = await deps.google.createInterviewEvent(createInput(current, 3));
        if (!created.ok) return persistGoogleFailure(deps.store, current, created);
        current = await persist(
          deps.store,
          current,
          uninvitedWrite(created, { conferenceAttempt: 3 }),
        );
        const resolved = await pollUntilResolved(current, created, deps);
        if (!resolved.ok) return persistGoogleFailure(deps.store, current, resolved);
        return inviteIfReady(current, resolved, deps, now().toISOString());
      }
    }

    const attempt = current.conferenceAttempt >= 1 ? current.conferenceAttempt : 1;
    const ensured = await ensureEvent(current, deps, attempt);
    if ("ok" in ensured) return ensured;
    current = ensured.row;
    const resolved = await pollUntilResolved(current, ensured.google, deps);
    if (!resolved.ok) return persistGoogleFailure(deps.store, current, resolved);
    return inviteIfReady(current, resolved, deps, now().toISOString());
  } finally {
    await deps.store.releaseLease(scheduleId);
  }
}

/**
 * Cancel the interview. Never-invited events are deleted with `sendUpdates=none`.
 * Invited events notify attendees (`sendUpdates=all` via `cancelInterviewEvent`).
 */
export async function cancelInterview(
  row: InterviewOrchestratorRow,
  deps: InterviewOrchestratorDeps,
): Promise<CancelInterviewFlowResult> {
  const now = deps.now ?? (() => new Date());
  const leaseMs = deps.leaseMs ?? INTERVIEW_LEASE_MS;
  const scheduleId = row.id;

  if (row.status === "cancelled") {
    return { ok: true, state: "cancelled", notifiedAttendees: Boolean(row.invitedAt), scheduleId };
  }

  const leased = await deps.store.tryAcquireLease(
    scheduleId,
    new Date(now().getTime() + leaseMs).toISOString(),
  );
  if (!leased) return { ok: false, code: "in_progress", retryable: true, scheduleId };

  try {
    let notifiedAttendees = Boolean(row.invitedAt || row.meetLink);
    if (row.googleEventId) {
      if (notifiedAttendees) {
        const cancelled = await deps.google.cancelInterviewEvent({ eventId: row.googleEventId });
        if (!cancelled.ok) {
          return { ok: false, code: cancelled.reason, retryable: cancelled.retryable, scheduleId };
        }
      } else {
        const discarded = await deps.google.discardUninvitedEvent({ eventId: row.googleEventId });
        if (!discarded.ok && discarded.reason === "google_event_has_attendees") {
          const cancelled = await deps.google.cancelInterviewEvent({ eventId: row.googleEventId });
          if (!cancelled.ok) {
            return {
              ok: false,
              code: cancelled.reason,
              retryable: cancelled.retryable,
              scheduleId,
            };
          }
          notifiedAttendees = true;
        } else if (!discarded.ok) {
          return { ok: false, code: discarded.reason, retryable: discarded.retryable, scheduleId };
        }
      }
    }

    await deps.store.save(scheduleId, {
      status: "cancelled",
      failureReason: null,
    });
    return { ok: true, state: "cancelled", notifiedAttendees, scheduleId };
  } finally {
    await deps.store.releaseLease(scheduleId);
  }
}

/** Deterministic event id for the current attempt — used by tests and later server functions. */
export function expectedEventIdForRow(
  row: Pick<InterviewOrchestratorRow, "id" | "conferenceAttempt">,
): string | null {
  return interviewEventIdFromScheduleId(row.id, row.conferenceAttempt);
}
