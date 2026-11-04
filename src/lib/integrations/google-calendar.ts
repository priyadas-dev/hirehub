/**
 * Google Calendar outbound integration for interview scheduling (Assessment 3, Track 1).
 *
 * Scope: create / get / invite / reschedule / cancel interview events through the REAL
 * Google Calendar REST API. Pure of Supabase and UI: callers own authorization and
 * persistence. No push notifications (events.watch) — attendee responses are synced by
 * a later polling job.
 *
 * Invite-after-link (Phase 3):
 * 1. Create the event WITHOUT attendees (`sendUpdates=none`) and request Meet via
 *    `conferenceData.createRequest` + `conferenceDataVersion=1`. Nobody is notified.
 * 2. Resolve the real `hangoutLink`. A Meet URL is never generated in this codebase.
 * 3. Only then PATCH attendees (`sendUpdates=all`). That is the single invitation moment.
 * 4. `meet_link` is persisted only after step 3. Create/get of an uninvited event never
 *    yields a "scheduled" row patch.
 *
 * Idempotency:
 * - Event id: attempt 1 = row uuid without dashes; recreate attempt N = that id + `a` + N.
 *   A retried insert returns HTTP 409 and is reconciled, never duplicated.
 * - Conference `requestId` is stable per (row, attempt). Failed Meet is retried on the
 *   SAME event with a new requestId (`…-attempt-N`), `sendUpdates=none`.
 * - Invitations: GET first; if both guests are already present, skip the PATCH.
 *
 * Secrets: server-only env (`GOOGLE_*`). Tokens, secrets and provider bodies are never
 * returned in results or logged.
 */
import { INTEGRATION_ENV, readIntegrationEnv } from "@/lib/integrations/env";

export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
/** Every Meet URL Google issues starts with this. We validate it; we never build one. */
export const GOOGLE_MEET_URL_PREFIX = "https://meet.google.com/";
export const DEFAULT_INTERVIEW_TIMEZONE = "Asia/Dhaka";
export const MAX_CONFERENCE_ATTEMPT = 3;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Google client-supplied event ids: base32hex characters, 5–1024 long. */
const EVENT_ID_RE = /^[a-v0-9]{5,1024}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InterviewResponse = "needsAction" | "accepted" | "declined" | "tentative";
export type ConferenceStatus = "pending" | "success" | "failure";

export type InterviewAttendee = {
  email: string;
  displayName?: string | null;
};

// ---------------------------------------------------------------------------
// Ids (deterministic => idempotent retries)
// ---------------------------------------------------------------------------

function isConferenceAttempt(attempt: number): boolean {
  return Number.isInteger(attempt) && attempt >= 1 && attempt <= MAX_CONFERENCE_ATTEMPT;
}

/**
 * Calendar event id for an interview row (valid base32hex).
 * Attempt 1: uuid without dashes. Recreate attempt N: that id + `a` + N.
 */
export function interviewEventIdFromScheduleId(scheduleId: string, attempt = 1): string | null {
  if (!isConferenceAttempt(attempt)) return null;
  const id = scheduleId.trim().toLowerCase();
  if (!UUID_RE.test(id)) return null;
  const base = id.replace(/-/g, "");
  return attempt === 1 ? base : `${base}a${attempt}`;
}

/** Stable Google Meet conference `requestId` per (row, attempt). */
export function interviewConferenceRequestId(scheduleId: string, attempt = 1): string {
  const id = scheduleId.trim().toLowerCase();
  if (attempt <= 1) return `hirehub-interview-${id}`;
  return `hirehub-interview-${id}-attempt-${attempt}`;
}

export function isValidInterviewEventId(eventId: string): boolean {
  return EVENT_ID_RE.test(eventId);
}

// ---------------------------------------------------------------------------
// Config + OAuth
// ---------------------------------------------------------------------------

export type GoogleCalendarConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
};

/** Returns null when any required Google credential is missing. `calendarId` defaults to `primary`. */
export function resolveGoogleCalendarConfig(
  env: NodeJS.ProcessEnv = process.env,
): GoogleCalendarConfig | null {
  const clientId = readIntegrationEnv(INTEGRATION_ENV.googleClientId, env);
  const clientSecret = readIntegrationEnv(INTEGRATION_ENV.googleClientSecret, env);
  const refreshToken = readIntegrationEnv(INTEGRATION_ENV.googleRefreshToken, env);
  if (!clientId || !clientSecret || !refreshToken) return null;
  const calendarId = readIntegrationEnv(INTEGRATION_ENV.googleCalendarId, env) || "primary";
  return { clientId, clientSecret, refreshToken, calendarId };
}

export type GoogleFailure = {
  ok: false;
  /** Short machine code. Never contains tokens, secrets, provider messages or PII. */
  reason: string;
  retryable: boolean;
  httpStatus?: number;
};

export type RefreshAccessTokenResult =
  { ok: true; accessToken: string; expiresInSec: number } | GoogleFailure;

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Safe read of a dynamic JSON field (the project forbids dot access on index signatures). */
function field(record: Record<string, unknown> | null | undefined, key: string): unknown {
  return record ? record[key] : undefined;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Exchange the long-lived refresh token for a short-lived access token (kept in memory only). */
export async function refreshGoogleAccessToken(
  config: GoogleCalendarConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<RefreshAccessTokenResult> {
  let res: Response;
  try {
    res = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
  } catch {
    return { ok: false, reason: "google_network_error", retryable: true };
  }

  const body = asRecord(await readJson(res));

  if (!res.ok) {
    const oauthError = str(field(body, "error"));
    // invalid_grant = refresh token expired/revoked (e.g. OAuth "Testing" apps expire in 7 days).
    if (oauthError === "invalid_grant") {
      return { ok: false, reason: "google_auth_revoked", retryable: false, httpStatus: res.status };
    }
    if (res.status >= 500 || res.status === 429) {
      return { ok: false, reason: "google_unavailable", retryable: true, httpStatus: res.status };
    }
    return { ok: false, reason: "google_auth_failed", retryable: false, httpStatus: res.status };
  }

  const accessToken = str(field(body, "access_token"));
  if (!accessToken) {
    return { ok: false, reason: "google_auth_failed", retryable: false, httpStatus: res.status };
  }
  const expiresIn = field(body, "expires_in");
  const expiresInSec = typeof expiresIn === "number" ? expiresIn : 3600;
  return { ok: true, accessToken, expiresInSec };
}

// ---------------------------------------------------------------------------
// Attendees (recruiter + seeker are both required)
// ---------------------------------------------------------------------------

export type BuildAttendeesResult =
  | {
      ok: true;
      attendees: Array<{ email: string; displayName?: string }>;
    }
  | {
      ok: false;
      reason: "recruiter_email_invalid" | "seeker_email_invalid" | "attendee_emails_must_differ";
    };

function normalizeAttendee(a: InterviewAttendee): { email: string; displayName?: string } | null {
  const email = a.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return null;
  const name = a.displayName
    ?.replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 120);
  return name ? { email, displayName: name } : { email };
}

/** Both the recruiter and the seeker must be invited, with different valid email addresses. */
export function buildInterviewAttendees(
  recruiter: InterviewAttendee,
  seeker: InterviewAttendee,
): BuildAttendeesResult {
  const r = normalizeAttendee(recruiter);
  if (!r) return { ok: false, reason: "recruiter_email_invalid" };
  const s = normalizeAttendee(seeker);
  if (!s) return { ok: false, reason: "seeker_email_invalid" };
  if (r.email === s.email) return { ok: false, reason: "attendee_emails_must_differ" };
  return { ok: true, attendees: [r, s] };
}

// ---------------------------------------------------------------------------
// Event body
// ---------------------------------------------------------------------------

export type InterviewEventInput = {
  /** `interview_schedules.id` — drives the idempotent event id + conference request id. */
  scheduleId: string;
  applicationId: string;
  jobTitle: string;
  companyName?: string | null;
  /** RFC 3339 date-time. */
  startAt: string;
  endAt: string;
  /** IANA timezone, default Asia/Dhaka. */
  timezone?: string;
  /**
   * Validated before create so we never open a Calendar event we cannot later invite to.
   * NOT placed on the create body — invitations go out in `sendInterviewInvitations`.
   */
  recruiter: InterviewAttendee;
  seeker: InterviewAttendee;
  /** Optional recruiter note shown in the event description. */
  notes?: string | null;
  /** Meet/event attempt 1..3. Recreate uses a new event id; retry-on-same-event uses a new requestId. */
  conferenceAttempt?: number;
};

export type BuildEventBodyResult =
  | { ok: true; eventId: string; body: Record<string, unknown> }
  | {
      ok: false;
      reason:
        | "invalid_schedule_id"
        | "invalid_conference_attempt"
        | "invalid_time"
        | "invalid_time_range"
        | "invalid_timezone"
        | "recruiter_email_invalid"
        | "seeker_email_invalid"
        | "attendee_emails_must_differ";
    };

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function oneLine(value: string, max: number): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, max);
}

type ValidatedTimes =
  | { ok: true; timezone: string }
  | { ok: false; reason: "invalid_time" | "invalid_time_range" | "invalid_timezone" };

function validateTimes(startAt: string, endAt: string, timezone?: string): ValidatedTimes {
  const tz = timezone?.trim() || DEFAULT_INTERVIEW_TIMEZONE;
  if (!isValidTimezone(tz)) return { ok: false, reason: "invalid_timezone" };
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end))
    return { ok: false, reason: "invalid_time" };
  if (end <= start) return { ok: false, reason: "invalid_time_range" };
  return { ok: true, timezone: tz };
}

/**
 * Builds the `events.insert` body. Requests a Meet conference through
 * `conferenceData.createRequest` (type `hangoutsMeet`) — it contains NO Meet URL
 * and NO attendees. Invitations are a later PATCH after the real hangoutLink exists.
 */
export function buildInterviewEventBody(input: InterviewEventInput): BuildEventBodyResult {
  const attempt = input.conferenceAttempt ?? 1;
  if (!isConferenceAttempt(attempt)) return { ok: false, reason: "invalid_conference_attempt" };
  const eventId = interviewEventIdFromScheduleId(input.scheduleId, attempt);
  if (!eventId) return { ok: false, reason: "invalid_schedule_id" };

  const times = validateTimes(input.startAt, input.endAt, input.timezone);
  if (!times.ok) return times;

  // Validate now so we never create a Calendar event we cannot invite to.
  const attendees = buildInterviewAttendees(input.recruiter, input.seeker);
  if (!attendees.ok) return attendees;

  const title = oneLine(input.jobTitle, 200) || "a role";
  const company = input.companyName ? oneLine(input.companyName, 120) : "";
  const summary = `Interview: ${title}${company ? ` — ${company}` : ""}`;

  const descriptionLines = [
    `HireHub interview for ${title}${company ? ` at ${company}` : ""}.`,
    "Join using the Google Meet link attached to this event.",
  ];
  const notes = input.notes?.trim().slice(0, 2000);
  if (notes) descriptionLines.push("", notes);

  return {
    ok: true,
    eventId,
    body: {
      id: eventId,
      summary,
      description: descriptionLines.join("\n"),
      start: { dateTime: input.startAt, timeZone: times.timezone },
      end: { dateTime: input.endAt, timeZone: times.timezone },
      // Privacy flags apply once guests are added later.
      guestsCanSeeOtherGuests: false,
      guestsCanInviteOthers: false,
      guestsCanModify: false,
      extendedProperties: {
        private: {
          hirehub_kind: "interview",
          hirehub_application_id: input.applicationId,
          hirehub_schedule_id: input.scheduleId.trim().toLowerCase(),
        },
      },
      conferenceData: {
        createRequest: {
          requestId: interviewConferenceRequestId(input.scheduleId, attempt),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Event parsing + conference classification
// ---------------------------------------------------------------------------

export type ConferenceOutcome =
  | { state: "ready"; meetLink: string }
  | { state: "pending"; reason: "meet_pending" | "meet_link_missing" | "meet_link_invalid" }
  | { state: "failed"; reason: "meet_creation_failed" };

/**
 * Classifies Google's conference creation result for an event resource.
 * `ready` ONLY when Google returned a `hangoutLink` on meet.google.com and the
 * conference is not still pending/failed. A conference id alone never yields a link.
 */
export function classifyConference(rawEvent: unknown): ConferenceOutcome {
  const event = asRecord(rawEvent);
  const conferenceData = asRecord(field(event, "conferenceData"));
  const createRequest = asRecord(field(conferenceData, "createRequest"));
  const statusCode = field(asRecord(field(createRequest, "status")), "statusCode");
  const hangoutLink = str(field(event, "hangoutLink")).trim();

  if (statusCode === "failure") return { state: "failed", reason: "meet_creation_failed" };

  if (hangoutLink) {
    if (!hangoutLink.startsWith(GOOGLE_MEET_URL_PREFIX)) {
      return { state: "pending", reason: "meet_link_invalid" };
    }
    if (statusCode === "pending") return { state: "pending", reason: "meet_pending" };
    return { state: "ready", meetLink: hangoutLink };
  }

  if (statusCode === "pending") return { state: "pending", reason: "meet_pending" };
  return { state: "pending", reason: "meet_link_missing" };
}

export function conferenceStatusOf(conference: ConferenceOutcome): ConferenceStatus {
  if (conference.state === "ready") return "success";
  if (conference.state === "failed") return "failure";
  return "pending";
}

export type InterviewEventSnapshot = {
  eventId: string;
  calendarStatus: "confirmed" | "tentative" | "cancelled" | "unknown";
  htmlLink: string | null;
  etag: string | null;
  /** Verbatim Google `hangoutLink` when it is a valid Meet URL; otherwise null. */
  meetLink: string | null;
  conferenceStatus: ConferenceStatus;
  /** Guest emails (organizer/self excluded). Empty until invitations are sent. */
  guestEmails: string[];
  /** Only populated when attendee emails were supplied; null when not found on the event. */
  recruiterResponse: InterviewResponse | null;
  seekerResponse: InterviewResponse | null;
  /** Value of private extended property `hirehub_schedule_id`, if present. */
  scheduleIdProperty: string | null;
};

/** Guest attendee emails; skips organizer/self so the HireHub calendar account is not treated as invited. */
export function listGuestEmails(rawEvent: unknown): string[] {
  const attendees = field(asRecord(rawEvent), "attendees");
  if (!Array.isArray(attendees)) return [];
  const emails: string[] = [];
  for (const a of attendees) {
    const rec = asRecord(a);
    if (!rec) continue;
    if (field(rec, "organizer") === true || field(rec, "self") === true) continue;
    const email = str(field(rec, "email")).trim().toLowerCase();
    if (email && !emails.includes(email)) emails.push(email);
  }
  return emails;
}

export function eventHasGuestAttendees(rawEvent: unknown): boolean {
  return listGuestEmails(rawEvent).length > 0;
}

export function eventHasBothGuests(
  rawEvent: unknown,
  recruiterEmail: string,
  seekerEmail: string,
): boolean {
  const guests = listGuestEmails(rawEvent);
  const recruiter = recruiterEmail.trim().toLowerCase();
  const seeker = seekerEmail.trim().toLowerCase();
  return guests.includes(recruiter) && guests.includes(seeker);
}

function mapResponse(value: unknown): InterviewResponse {
  return value === "accepted" || value === "declined" || value === "tentative"
    ? value
    : "needsAction";
}

function findResponse(attendees: unknown, email?: string): InterviewResponse | null {
  if (!email || !Array.isArray(attendees)) return null;
  const wanted = email.trim().toLowerCase();
  for (const a of attendees) {
    const rec = asRecord(a);
    if (str(field(rec, "email")).trim().toLowerCase() === wanted) {
      return mapResponse(field(rec, "responseStatus"));
    }
  }
  return null;
}

export function parseInterviewEvent(
  rawEvent: unknown,
  emails: { recruiterEmail?: string; seekerEmail?: string } = {},
): InterviewEventSnapshot | null {
  const event = asRecord(rawEvent);
  const eventId = str(field(event, "id"));
  if (!event || !eventId) return null;

  const rawStatus = field(event, "status");
  const status =
    rawStatus === "confirmed" || rawStatus === "tentative" || rawStatus === "cancelled"
      ? rawStatus
      : "unknown";

  const conference = classifyConference(event);
  const priv = asRecord(field(asRecord(field(event, "extendedProperties")), "private"));
  const attendees = field(event, "attendees");

  return {
    eventId,
    calendarStatus: status,
    htmlLink: str(field(event, "htmlLink")) || null,
    etag: str(field(event, "etag")) || null,
    meetLink: conference.state === "ready" ? conference.meetLink : null,
    conferenceStatus: conferenceStatusOf(conference),
    guestEmails: listGuestEmails(event),
    recruiterResponse: findResponse(attendees, emails.recruiterEmail),
    seekerResponse: findResponse(attendees, emails.seekerEmail),
    scheduleIdProperty: str(field(priv, "hirehub_schedule_id")) || null,
  };
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

export type GoogleCalendarCallOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
};

type CalendarContext = {
  accessToken: string;
  calendarId: string;
  fetchImpl: typeof fetch;
};

type RawCalendarResponse = { status: number; ok: boolean; json: unknown };

function classifyHttpFailure(status: number, json: unknown): GoogleFailure {
  const errors = field(asRecord(field(asRecord(json), "error")), "errors");
  const firstReason = Array.isArray(errors) ? str(field(asRecord(errors[0]), "reason")) : "";

  if (status === 429)
    return { ok: false, reason: "google_rate_limited", retryable: true, httpStatus: status };
  if (status === 403) {
    if (/ratelimit|quota|limitexceeded/i.test(firstReason)) {
      return { ok: false, reason: "google_rate_limited", retryable: true, httpStatus: status };
    }
    return { ok: false, reason: "google_forbidden", retryable: false, httpStatus: status };
  }
  if (status === 401)
    return { ok: false, reason: "google_auth_failed", retryable: false, httpStatus: status };
  if (status === 400)
    return { ok: false, reason: "google_bad_request", retryable: false, httpStatus: status };
  if (status === 404)
    return { ok: false, reason: "google_event_not_found", retryable: false, httpStatus: status };
  if (status === 409)
    return { ok: false, reason: "google_conflict", retryable: false, httpStatus: status };
  if (status === 410)
    return { ok: false, reason: "google_event_gone", retryable: false, httpStatus: status };
  if (status >= 500)
    return { ok: false, reason: "google_unavailable", retryable: true, httpStatus: status };
  return { ok: false, reason: `google_http_${status}`, retryable: false, httpStatus: status };
}

async function calendarRequest(
  ctx: CalendarContext,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  query: Record<string, string>,
  body?: Record<string, unknown>,
): Promise<RawCalendarResponse | GoogleFailure> {
  const qs = new URLSearchParams(query).toString();
  const url = `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(ctx.calendarId)}/events${path}${qs ? `?${qs}` : ""}`;
  let res: Response;
  try {
    res = await ctx.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    return { ok: false, reason: "google_network_error", retryable: true };
  }
  const json = method === "DELETE" && res.status === 204 ? null : await readJson(res);
  return { status: res.status, ok: res.ok, json };
}

function isFailure(value: RawCalendarResponse | GoogleFailure): value is GoogleFailure {
  return (value as GoogleFailure).ok === false && "reason" in value;
}

async function withCalendar<T extends { ok: boolean }>(
  options: GoogleCalendarCallOptions,
  run: (ctx: CalendarContext) => Promise<T>,
): Promise<T | GoogleFailure> {
  const config = resolveGoogleCalendarConfig(options.env ?? process.env);
  if (!config) return { ok: false, reason: "google_not_configured", retryable: false };
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = await refreshGoogleAccessToken(config, fetchImpl);
  if (!token.ok) return token;
  return run({ accessToken: token.accessToken, calendarId: config.calendarId, fetchImpl });
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type InterviewEventOutcome =
  /** Real Meet link exists. Invitations have NOT been sent; keep the DB row `pending`. */
  | "conference_ready"
  /** Event exists but Google has not issued the Meet link yet => keep `pending`. */
  | "conference_pending"
  /** Google reported Meet creation failure => do not invite; recruiter may retry. */
  | "conference_failed";

export type InterviewEventSuccess = {
  ok: true;
  outcome: InterviewEventOutcome;
  event: InterviewEventSnapshot;
  conference: ConferenceOutcome;
  /** True when Google already had this event (idempotent retry / HTTP 409). */
  alreadyExisted: boolean;
  calendarId: string;
};

function toSuccess(
  raw: unknown,
  emails: { recruiterEmail?: string; seekerEmail?: string },
  calendarId: string,
  alreadyExisted: boolean,
): InterviewEventSuccess | GoogleFailure {
  const event = parseInterviewEvent(raw, emails);
  if (!event) return { ok: false, reason: "google_invalid_response", retryable: false };
  const conference = classifyConference(raw);
  const outcome: InterviewEventOutcome =
    conference.state === "ready"
      ? "conference_ready"
      : conference.state === "failed"
        ? "conference_failed"
        : "conference_pending";
  return { ok: true, outcome, event, conference, alreadyExisted, calendarId };
}

/**
 * Create the interview event with a Google Meet conference and NO attendees.
 * `sendUpdates=none` so nobody is notified while Meet is still being created.
 * Idempotent: a retry (HTTP 409 on the deterministic event id) reconciles the existing event.
 */
export async function createInterviewEvent(
  input: InterviewEventInput,
  options: GoogleCalendarCallOptions = {},
): Promise<InterviewEventSuccess | GoogleFailure> {
  const built = buildInterviewEventBody(input);
  if (!built.ok) return { ok: false, reason: built.reason, retryable: false };

  const emails = { recruiterEmail: input.recruiter.email, seekerEmail: input.seeker.email };
  const scheduleId = input.scheduleId.trim().toLowerCase();

  return withCalendar(options, async (ctx) => {
    const res = await calendarRequest(
      ctx,
      "POST",
      "",
      { conferenceDataVersion: "1", sendUpdates: "none" },
      built.body,
    );
    if (isFailure(res)) return res;
    if (res.ok) return toSuccess(res.json, emails, ctx.calendarId, false);
    if (res.status !== 409) return classifyHttpFailure(res.status, res.json);

    // Retry of an already-created event: reconcile instead of creating a duplicate.
    const existing = await calendarRequest(ctx, "GET", `/${encodeURIComponent(built.eventId)}`, {});
    if (isFailure(existing)) return existing;
    if (!existing.ok) return classifyHttpFailure(existing.status, existing.json);

    const snapshot = parseInterviewEvent(existing.json, emails);
    if (!snapshot)
      return { ok: false, reason: "google_invalid_response", retryable: false } as GoogleFailure;
    if (snapshot.scheduleIdProperty && snapshot.scheduleIdProperty !== scheduleId) {
      return { ok: false, reason: "google_event_id_conflict", retryable: false } as GoogleFailure;
    }
    if (snapshot.calendarStatus === "cancelled") {
      // A deleted event id cannot be reused; the caller must create a new interview row.
      return { ok: false, reason: "google_event_cancelled", retryable: false } as GoogleFailure;
    }
    return toSuccess(existing.json, emails, ctx.calendarId, true);
  });
}

/**
 * Read the current event state. Used to resolve a still-pending Meet conference and,
 * later, by the polling sync to pick up attendee responses and cancellations.
 */
export async function getInterviewEvent(
  input: { eventId: string; recruiterEmail?: string; seekerEmail?: string },
  options: GoogleCalendarCallOptions = {},
): Promise<InterviewEventSuccess | GoogleFailure> {
  if (!isValidInterviewEventId(input.eventId)) {
    return { ok: false, reason: "invalid_event_id", retryable: false };
  }
  return withCalendar(options, async (ctx) => {
    const res = await calendarRequest(ctx, "GET", `/${encodeURIComponent(input.eventId)}`, {});
    if (isFailure(res)) return res;
    if (!res.ok) return classifyHttpFailure(res.status, res.json);
    return toSuccess(res.json, input, ctx.calendarId, true);
  });
}

/** Alias with intent: re-check whether Google has finished creating the Meet link. */
export const resolveInterviewConference = getInterviewEvent;

export type InviteInterviewSuccess = {
  ok: true;
  alreadyInvited: boolean;
  event: InterviewEventSnapshot;
  meetLink: string;
  calendarId: string;
};

/**
 * Invite recruiter + seeker ONLY after a real hangoutLink exists.
 * GET first: if both guests are already present, skip the PATCH (no duplicate invitations).
 */
export async function sendInterviewInvitations(
  input: {
    eventId: string;
    recruiter: InterviewAttendee;
    seeker: InterviewAttendee;
  },
  options: GoogleCalendarCallOptions = {},
): Promise<InviteInterviewSuccess | GoogleFailure> {
  if (!isValidInterviewEventId(input.eventId)) {
    return { ok: false, reason: "invalid_event_id", retryable: false };
  }
  const attendees = buildInterviewAttendees(input.recruiter, input.seeker);
  if (!attendees.ok) return { ok: false, reason: attendees.reason, retryable: false };

  const emails = {
    recruiterEmail: attendees.attendees[0]!.email,
    seekerEmail: attendees.attendees[1]!.email,
  };

  return withCalendar(options, async (ctx) => {
    const existing = await calendarRequest(ctx, "GET", `/${encodeURIComponent(input.eventId)}`, {});
    if (isFailure(existing)) return existing;
    if (!existing.ok) return classifyHttpFailure(existing.status, existing.json);

    const snapshot = parseInterviewEvent(existing.json, emails);
    if (!snapshot) return { ok: false, reason: "google_invalid_response", retryable: false };
    if (snapshot.calendarStatus === "cancelled") {
      return { ok: false, reason: "google_event_cancelled", retryable: false };
    }

    const conference = classifyConference(existing.json);
    if (conference.state !== "ready") {
      return {
        ok: false,
        reason: conference.state === "failed" ? "meet_creation_failed" : "meet_not_ready",
        retryable: conference.state === "pending",
      };
    }

    if (eventHasBothGuests(existing.json, emails.recruiterEmail, emails.seekerEmail)) {
      return {
        ok: true,
        alreadyInvited: true,
        event: snapshot,
        meetLink: conference.meetLink,
        calendarId: ctx.calendarId,
      };
    }

    const patched = await calendarRequest(
      ctx,
      "PATCH",
      `/${encodeURIComponent(input.eventId)}`,
      { sendUpdates: "all" },
      {
        attendees: attendees.attendees,
        guestsCanSeeOtherGuests: false,
        guestsCanInviteOthers: false,
        guestsCanModify: false,
      },
    );
    if (isFailure(patched)) return patched;
    if (!patched.ok) return classifyHttpFailure(patched.status, patched.json);

    const after = parseInterviewEvent(patched.json, emails);
    const afterConference = classifyConference(patched.json);
    if (!after || afterConference.state !== "ready") {
      return { ok: false, reason: "meet_not_ready", retryable: true };
    }
    return {
      ok: true,
      alreadyInvited: false,
      event: after,
      meetLink: afterConference.meetLink,
      calendarId: ctx.calendarId,
    };
  });
}

/**
 * Retry Meet creation on the SAME event after a conference failure.
 * New `requestId` (`…-attempt-N`), `sendUpdates=none`. Refuses if guests were already invited.
 */
export async function requestConferenceRetry(
  input: { eventId: string; scheduleId: string; attempt: number },
  options: GoogleCalendarCallOptions = {},
): Promise<InterviewEventSuccess | GoogleFailure> {
  if (!isValidInterviewEventId(input.eventId)) {
    return { ok: false, reason: "invalid_event_id", retryable: false };
  }
  if (!isConferenceAttempt(input.attempt) || input.attempt < 2) {
    return { ok: false, reason: "invalid_conference_attempt", retryable: false };
  }
  if (!UUID_RE.test(input.scheduleId.trim())) {
    return { ok: false, reason: "invalid_schedule_id", retryable: false };
  }

  return withCalendar(options, async (ctx) => {
    const existing = await calendarRequest(ctx, "GET", `/${encodeURIComponent(input.eventId)}`, {});
    if (isFailure(existing)) return existing;
    if (!existing.ok) return classifyHttpFailure(existing.status, existing.json);

    const snapshot = parseInterviewEvent(existing.json);
    if (!snapshot) return { ok: false, reason: "google_invalid_response", retryable: false };
    if (snapshot.calendarStatus === "cancelled") {
      return { ok: false, reason: "google_event_cancelled", retryable: false };
    }
    if (eventHasGuestAttendees(existing.json)) {
      return { ok: false, reason: "google_already_invited", retryable: false };
    }

    const current = classifyConference(existing.json);
    if (current.state === "ready") {
      return toSuccess(existing.json, {}, ctx.calendarId, true);
    }

    const patched = await calendarRequest(
      ctx,
      "PATCH",
      `/${encodeURIComponent(input.eventId)}`,
      { conferenceDataVersion: "1", sendUpdates: "none" },
      {
        conferenceData: {
          createRequest: {
            requestId: interviewConferenceRequestId(input.scheduleId, input.attempt),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
    );
    if (isFailure(patched)) return patched;
    if (!patched.ok) return classifyHttpFailure(patched.status, patched.json);
    return toSuccess(patched.json, {}, ctx.calendarId, true);
  });
}

export type DiscardUninvitedResult = { ok: true; alreadyDiscarded: boolean } | GoogleFailure;

/**
 * Delete an event that nobody was invited to (`sendUpdates=none`).
 * Refuses if any guest attendee is present — those must be cancelled with notifications.
 */
export async function discardUninvitedEvent(
  input: { eventId: string },
  options: GoogleCalendarCallOptions = {},
): Promise<DiscardUninvitedResult> {
  if (!isValidInterviewEventId(input.eventId)) {
    return { ok: false, reason: "invalid_event_id", retryable: false };
  }
  return withCalendar<DiscardUninvitedResult>(options, async (ctx) => {
    const existing = await calendarRequest(ctx, "GET", `/${encodeURIComponent(input.eventId)}`, {});
    if (isFailure(existing)) return existing;
    if (existing.status === 404 || existing.status === 410) {
      return { ok: true, alreadyDiscarded: true };
    }
    if (!existing.ok) return classifyHttpFailure(existing.status, existing.json);

    if (eventHasGuestAttendees(existing.json)) {
      return { ok: false, reason: "google_event_has_attendees", retryable: false };
    }

    const del = await calendarRequest(ctx, "DELETE", `/${encodeURIComponent(input.eventId)}`, {
      sendUpdates: "none",
    });
    if (isFailure(del)) return del;
    if (del.ok || del.status === 404 || del.status === 410) {
      return { ok: true, alreadyDiscarded: false };
    }
    return classifyHttpFailure(del.status, del.json);
  });
}

export type RescheduleInterviewInput = {
  eventId: string;
  startAt: string;
  endAt: string;
  timezone?: string;
  recruiterEmail?: string;
  seekerEmail?: string;
};

/**
 * Move an existing event. Does NOT resend `conferenceData`, so the existing Meet link is
 * kept and no second conference is created. Attendees are notified (`sendUpdates=all`).
 */
export async function rescheduleInterviewEvent(
  input: RescheduleInterviewInput,
  options: GoogleCalendarCallOptions = {},
): Promise<InterviewEventSuccess | GoogleFailure> {
  if (!isValidInterviewEventId(input.eventId)) {
    return { ok: false, reason: "invalid_event_id", retryable: false };
  }
  const times = validateTimes(input.startAt, input.endAt, input.timezone);
  if (!times.ok) return { ok: false, reason: times.reason, retryable: false };

  return withCalendar(options, async (ctx) => {
    const res = await calendarRequest(
      ctx,
      "PATCH",
      `/${encodeURIComponent(input.eventId)}`,
      { conferenceDataVersion: "1", sendUpdates: "all" },
      {
        start: { dateTime: input.startAt, timeZone: times.timezone },
        end: { dateTime: input.endAt, timeZone: times.timezone },
      },
    );
    if (isFailure(res)) return res;
    if (!res.ok) return classifyHttpFailure(res.status, res.json);
    return toSuccess(res.json, input, ctx.calendarId, true);
  });
}

export type CancelInterviewResult = { ok: true; alreadyCancelled: boolean } | GoogleFailure;

/** Cancel (delete) the event and notify attendees. Idempotent: 404/410 count as already cancelled. */
export async function cancelInterviewEvent(
  input: { eventId: string },
  options: GoogleCalendarCallOptions = {},
): Promise<CancelInterviewResult> {
  if (!isValidInterviewEventId(input.eventId)) {
    return { ok: false, reason: "invalid_event_id", retryable: false };
  }
  return withCalendar<CancelInterviewResult>(options, async (ctx) => {
    const res = await calendarRequest(ctx, "DELETE", `/${encodeURIComponent(input.eventId)}`, {
      sendUpdates: "all",
    });
    if (isFailure(res)) return res;
    if (res.ok) return { ok: true, alreadyCancelled: false };
    if (res.status === 404 || res.status === 410) return { ok: true, alreadyCancelled: true };
    return classifyHttpFailure(res.status, res.json);
  });
}

// ---------------------------------------------------------------------------
// Persistence mapping (used by Phase 3 server functions)
// ---------------------------------------------------------------------------

export type InterviewScheduleRowPatch = {
  status: "pending" | "scheduled" | "cancelled" | "failed";
  conference_status: ConferenceStatus;
  google_event_id: string;
  google_calendar_id: string;
  html_link: string | null;
  etag: string | null;
  recruiter_response?: InterviewResponse;
  seeker_response?: InterviewResponse;
  /** Present ONLY after invitations were sent with a real Google Meet link. */
  meet_link?: string;
  failure_reason: string | null;
};

/**
 * Maps a Google result to an `interview_schedules` column patch.
 *
 * `meet_link` and status=`scheduled` are written ONLY when `invitationsSent` is true
 * AND Google returned a real hangoutLink. Create/get of an uninvited event (even with
 * a ready conference) stays `pending` with no link — matching PROPOSED_0025.
 */
export function buildScheduleRowPatch(
  result: InterviewEventSuccess,
  options: { invitationsSent?: boolean } = {},
): InterviewScheduleRowPatch {
  const { event, conference } = result;
  const invitationsSent = options.invitationsSent === true;

  let status: InterviewScheduleRowPatch["status"];
  let failureReason: string | null = null;
  let conferenceStatus: ConferenceStatus = "pending";

  if (event.calendarStatus === "cancelled") {
    status = "cancelled";
    conferenceStatus = event.conferenceStatus;
  } else if (invitationsSent && conference.state === "ready") {
    status = "scheduled";
    conferenceStatus = "success";
  } else if (conference.state === "failed") {
    status = "failed";
    conferenceStatus = "failure";
    failureReason = conference.reason;
  } else {
    status = "pending";
    conferenceStatus = "pending";
    failureReason = conference.state === "ready" ? null : conference.reason;
  }

  return {
    status,
    conference_status: conferenceStatus,
    google_event_id: event.eventId,
    google_calendar_id: result.calendarId,
    html_link: event.htmlLink,
    etag: event.etag,
    ...(event.recruiterResponse ? { recruiter_response: event.recruiterResponse } : {}),
    ...(event.seekerResponse ? { seeker_response: event.seekerResponse } : {}),
    ...(invitationsSent && conference.state === "ready" ? { meet_link: conference.meetLink } : {}),
    failure_reason: failureReason,
  };
}

/** Row patch after a successful invitation (real Meet link + attendees notified). */
export function buildInvitedScheduleRowPatch(
  result: InviteInterviewSuccess,
): InterviewScheduleRowPatch {
  return {
    status: "scheduled",
    conference_status: "success",
    google_event_id: result.event.eventId,
    google_calendar_id: result.calendarId,
    html_link: result.event.htmlLink,
    etag: result.event.etag,
    ...(result.event.recruiterResponse
      ? { recruiter_response: result.event.recruiterResponse }
      : {}),
    ...(result.event.seekerResponse ? { seeker_response: result.event.seekerResponse } : {}),
    meet_link: result.meetLink,
    failure_reason: null,
  };
}
