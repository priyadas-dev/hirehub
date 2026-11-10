import { describe, expect, it, vi } from "vitest";
import { INTEGRATION_ENV } from "@/lib/integrations/env";
import {
  GOOGLE_CALENDAR_API_BASE,
  GOOGLE_MEET_URL_PREFIX,
  GOOGLE_OAUTH_TOKEN_URL,
  buildInterviewAttendees,
  buildInterviewEventBody,
  buildInvitedScheduleRowPatch,
  buildScheduleRowPatch,
  cancelInterviewEvent,
  classifyConference,
  createInterviewEvent,
  discardUninvitedEvent,
  getInterviewEvent,
  interviewConferenceRequestId,
  interviewEventIdFromScheduleId,
  refreshGoogleAccessToken,
  requestConferenceRetry,
  rescheduleInterviewEvent,
  resolveGoogleCalendarConfig,
  resolveInterviewConference,
  sendInterviewInvitations,
  type InterviewEventInput,
  type InterviewEventSuccess,
} from "@/lib/integrations/google-calendar";

const SCHEDULE_ID = "3f2b1c4e-8a7d-4e6f-9b1a-0c2d3e4f5a6b";
const EVENT_ID = "3f2b1c4e8a7d4e6f9b1a0c2d3e4f5a6b";
const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";
const REAL_MEET_LINK = "https://meet.google.com/abc-defg-hij";

const CLIENT_SECRET = "test-client-secret";
const REFRESH_TOKEN = "test-refresh-token";
const ACCESS_TOKEN = "ya29.test-access-token";

const ENV = {
  [INTEGRATION_ENV.googleClientId]: "test-client-id",
  [INTEGRATION_ENV.googleClientSecret]: CLIENT_SECRET,
  [INTEGRATION_ENV.googleRefreshToken]: REFRESH_TOKEN,
  [INTEGRATION_ENV.googleCalendarId]: "primary",
} as unknown as NodeJS.ProcessEnv;

const INPUT: InterviewEventInput = {
  scheduleId: SCHEDULE_ID,
  applicationId: APPLICATION_ID,
  jobTitle: "Senior Backend Engineer",
  companyName: "Acme Corp",
  startAt: "2026-11-10T10:00:00+06:00",
  endAt: "2026-11-10T10:45:00+06:00",
  timezone: "Asia/Dhaka",
  recruiter: { email: "Recruiter@Example.com", displayName: "Rita Recruiter" },
  seeker: { email: "seeker@example.com", displayName: "Sam Seeker" },
};

type MockResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function jsonResponse(status: number, body: unknown): MockResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const tokenOk = () => jsonResponse(200, { access_token: ACCESS_TOKEN, expires_in: 3600 });

/** Event resource as Google returns it after Meet is ready and BEFORE invitations. */
function googleEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: EVENT_ID,
    status: "confirmed",
    htmlLink: "https://www.google.com/calendar/event?eid=abc123",
    etag: '"3300000000000000"',
    hangoutLink: REAL_MEET_LINK,
    conferenceData: {
      createRequest: {
        requestId: interviewConferenceRequestId(SCHEDULE_ID),
        status: { statusCode: "success" },
      },
      conferenceId: "abc-defg-hij",
    },
    attendees: [],
    extendedProperties: { private: { hirehub_schedule_id: SCHEDULE_ID } },
    ...overrides,
  };
}

function invitedAttendees(
  recruiterStatus = "needsAction",
  seekerStatus = "needsAction",
): Array<{ email: string; responseStatus: string }> {
  return [
    { email: "recruiter@example.com", responseStatus: recruiterStatus },
    { email: "seeker@example.com", responseStatus: seekerStatus },
  ];
}

function googleEventInvited(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return googleEvent({ attendees: invitedAttendees(), ...overrides });
}

/** Event as Google returns it while the Meet conference is still being created. */
function googleEventPendingMeet(): Record<string, unknown> {
  const e = googleEvent({
    conferenceData: {
      createRequest: {
        requestId: interviewConferenceRequestId(SCHEDULE_ID),
        status: { statusCode: "pending" },
      },
    },
  });
  delete e["hangoutLink"];
  return e;
}

type QueueItem = MockResponse | "network-error";

function googleFetch(queue: QueueItem[], tokenResponse: MockResponse = tokenOk()) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url === GOOGLE_OAUTH_TOKEN_URL) return tokenResponse;
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request: ${url}`);
    if (next === "network-error") throw new Error("socket hang up");
    return next;
  });
  return {
    fetchImpl: impl as unknown as typeof fetch,
    calls,
    calendarCalls: () => calls.filter((c) => c.url !== GOOGLE_OAUTH_TOKEN_URL),
  };
}

type SentEventBody = {
  id: string;
  conferenceData?: {
    createRequest: { requestId: string; conferenceSolutionKey: { type: string } };
  };
  attendees?: Array<{ email: string }>;
};

function sentBody(call: { init: RequestInit }): SentEventBody {
  return JSON.parse(String(call.init.body)) as SentEventBody;
}

function expectOk(result: unknown): InterviewEventSuccess {
  const r = result as InterviewEventSuccess & { reason?: string };
  expect(r.ok, `expected ok, got failure: ${r.reason}`).toBe(true);
  return r;
}

describe("google-calendar: ids and config", () => {
  it("derives the Calendar event id from the interview row id (deterministic)", () => {
    expect(interviewEventIdFromScheduleId(SCHEDULE_ID)).toBe(EVENT_ID);
    expect(interviewEventIdFromScheduleId(SCHEDULE_ID.toUpperCase())).toBe(EVENT_ID);
    expect(interviewEventIdFromScheduleId("not-a-uuid")).toBeNull();
    expect(interviewEventIdFromScheduleId(SCHEDULE_ID, 2)).toBe(`${EVENT_ID}a2`);
    expect(interviewEventIdFromScheduleId(SCHEDULE_ID, 3)).toBe(`${EVENT_ID}a3`);
    expect(interviewEventIdFromScheduleId(SCHEDULE_ID, 4)).toBeNull();
    expect(interviewConferenceRequestId(SCHEDULE_ID, 2)).toBe(
      `hirehub-interview-${SCHEDULE_ID}-attempt-2`,
    );
    expect(interviewConferenceRequestId(SCHEDULE_ID)).toBe(
      interviewConferenceRequestId(SCHEDULE_ID),
    );
  });

  it("returns null config when credentials are missing and defaults calendar id to primary", () => {
    expect(resolveGoogleCalendarConfig({} as NodeJS.ProcessEnv)).toBeNull();
    const cfg = resolveGoogleCalendarConfig({
      [INTEGRATION_ENV.googleClientId]: "id",
      [INTEGRATION_ENV.googleClientSecret]: "secret",
      [INTEGRATION_ENV.googleRefreshToken]: "refresh",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg?.calendarId).toBe("primary");
  });

  it("fails closed with google_not_configured and makes no network call", async () => {
    const { fetchImpl, calls } = googleFetch([]);
    const result = await createInterviewEvent(INPUT, { env: {} as NodeJS.ProcessEnv, fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: "google_not_configured", retryable: false });
    expect(calls).toHaveLength(0);
  });
});

describe("google-calendar: attendees (recruiter + seeker)", () => {
  it("includes both attendees, lower-cased", () => {
    const result = buildInterviewAttendees(INPUT.recruiter, INPUT.seeker);
    expect(result).toEqual({
      ok: true,
      attendees: [
        { email: "recruiter@example.com", displayName: "Rita Recruiter" },
        { email: "seeker@example.com", displayName: "Sam Seeker" },
      ],
    });
  });

  it("rejects an invalid email or identical emails", () => {
    expect(buildInterviewAttendees({ email: "nope" }, INPUT.seeker)).toEqual({
      ok: false,
      reason: "recruiter_email_invalid",
    });
    expect(buildInterviewAttendees(INPUT.recruiter, { email: "" })).toEqual({
      ok: false,
      reason: "seeker_email_invalid",
    });
    expect(
      buildInterviewAttendees({ email: "same@example.com" }, { email: "SAME@example.com" }),
    ).toEqual({ ok: false, reason: "attendee_emails_must_differ" });
  });
});

describe("google-calendar: event body", () => {
  it("requests a real Meet conference via conferenceData.createRequest and builds no Meet URL", () => {
    const built = buildInterviewEventBody(INPUT);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.eventId).toBe(EVENT_ID);
    expect(built.body["id"]).toBe(EVENT_ID);
    expect(built.body["conferenceData"]).toEqual({
      createRequest: {
        requestId: interviewConferenceRequestId(SCHEDULE_ID),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    });
    // The request must never carry a Meet URL / hangoutLink — Google generates it.
    const serialized = JSON.stringify(built.body);
    expect(serialized).not.toContain("meet.google.com");
    expect(serialized).not.toContain("hangoutLink");
  });

  it("does not put attendees on the create body (invitations are a later PATCH)", () => {
    const built = buildInterviewEventBody(INPUT);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.body).not.toHaveProperty("attendees");
    expect(JSON.stringify(built.body)).not.toContain("recruiter@example.com");
    expect(JSON.stringify(built.body)).not.toContain("seeker@example.com");
    expect(built.body).toMatchObject({
      guestsCanSeeOtherGuests: false,
      guestsCanInviteOthers: false,
      guestsCanModify: false,
      extendedProperties: {
        private: {
          hirehub_kind: "interview",
          hirehub_application_id: APPLICATION_ID,
          hirehub_schedule_id: SCHEDULE_ID,
        },
      },
    });
  });

  it("uses a new event id and requestId for recreate attempts", () => {
    const built = buildInterviewEventBody({ ...INPUT, conferenceAttempt: 3 });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.eventId).toBe(`${EVENT_ID}a3`);
    expect(built.body["id"]).toBe(`${EVENT_ID}a3`);
    expect(built.body["conferenceData"]).toEqual({
      createRequest: {
        requestId: interviewConferenceRequestId(SCHEDULE_ID, 3),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    });
  });

  it("rejects invalid ids, time ranges, timezones", () => {
    expect(buildInterviewEventBody({ ...INPUT, scheduleId: "bad" })).toEqual({
      ok: false,
      reason: "invalid_schedule_id",
    });
    expect(buildInterviewEventBody({ ...INPUT, startAt: "garbage" })).toEqual({
      ok: false,
      reason: "invalid_time",
    });
    expect(buildInterviewEventBody({ ...INPUT, endAt: INPUT.startAt })).toEqual({
      ok: false,
      reason: "invalid_time_range",
    });
    expect(buildInterviewEventBody({ ...INPUT, timezone: "Mars/Olympus" })).toEqual({
      ok: false,
      reason: "invalid_timezone",
    });
  });
});

describe("google-calendar: Meet link generation (success)", () => {
  it("creates the event with conferenceDataVersion=1, no attendees, and sendUpdates=none", async () => {
    const { fetchImpl, calendarCalls } = googleFetch([jsonResponse(200, googleEvent())]);

    const result = expectOk(await createInterviewEvent(INPUT, { env: ENV, fetchImpl }));

    expect(result.outcome).toBe("conference_ready");
    expect(result.alreadyExisted).toBe(false);
    expect(result.event.meetLink).toBe(REAL_MEET_LINK);
    expect(result.event.meetLink?.startsWith(GOOGLE_MEET_URL_PREFIX)).toBe(true);
    expect(result.event.guestEmails).toEqual([]);
    expect(result.conference).toEqual({ state: "ready", meetLink: REAL_MEET_LINK });

    expect(calendarCalls()).toHaveLength(1);
    const call = calendarCalls()[0]!;
    expect(call.init.method).toBe("POST");
    const url = new URL(call.url);
    expect(`${url.origin}${url.pathname}`).toBe(
      `${GOOGLE_CALENDAR_API_BASE}/calendars/primary/events`,
    );
    expect(url.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(url.searchParams.get("sendUpdates")).toBe("none");
    expect((call.init.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${ACCESS_TOKEN}`,
    );

    const sent = sentBody(call);
    expect(sent.conferenceData?.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
    expect(sent).not.toHaveProperty("attendees");
    expect(String(call.init.body)).not.toContain("meet.google.com");
  });

  it("does not mark the row scheduled or persist meet_link until invitations are sent", async () => {
    const { fetchImpl } = googleFetch([jsonResponse(200, googleEvent())]);
    const result = expectOk(await createInterviewEvent(INPUT, { env: ENV, fetchImpl }));
    const uninvited = buildScheduleRowPatch(result);
    expect(uninvited).toMatchObject({
      status: "pending",
      conference_status: "pending",
      google_event_id: EVENT_ID,
      google_calendar_id: "primary",
      failure_reason: null,
    });
    expect("meet_link" in uninvited).toBe(false);

    const invited = buildScheduleRowPatch(result, { invitationsSent: true });
    expect(invited).toMatchObject({
      status: "scheduled",
      conference_status: "success",
      meet_link: REAL_MEET_LINK,
      failure_reason: null,
    });
  });

  it("exchanges the refresh token for an access token without leaking secrets in results", async () => {
    const { fetchImpl, calls } = googleFetch([jsonResponse(200, googleEvent())]);
    const result = await createInterviewEvent(INPUT, { env: ENV, fetchImpl });

    const tokenCall = calls.find((c) => c.url === GOOGLE_OAUTH_TOKEN_URL)!;
    const form = new URLSearchParams(String(tokenCall.init.body));
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe(REFRESH_TOKEN);

    const serialized = JSON.stringify(result);
    for (const secret of [CLIENT_SECRET, REFRESH_TOKEN, ACCESS_TOKEN]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe("google-calendar: missing / pending Meet link", () => {
  it("does NOT mark scheduled when Google returns no hangoutLink (conference id alone is not a link)", async () => {
    const event = googleEvent();
    delete event["hangoutLink"]; // conferenceId "abc-defg-hij" is still present
    const { fetchImpl } = googleFetch([jsonResponse(200, event)]);

    const result = expectOk(await createInterviewEvent(INPUT, { env: ENV, fetchImpl }));

    expect(result.outcome).toBe("conference_pending");
    expect(result.conference).toEqual({ state: "pending", reason: "meet_link_missing" });
    expect(result.event.meetLink).toBeNull();

    const patch = buildScheduleRowPatch(result);
    expect(patch.status).toBe("pending");
    expect(patch.conference_status).toBe("pending");
    expect("meet_link" in patch).toBe(false); // never fabricate a link
    expect(patch.failure_reason).toBe("meet_link_missing");
  });

  it("keeps the interview pending while Google reports conference statusCode=pending", async () => {
    const { fetchImpl } = googleFetch([jsonResponse(200, googleEventPendingMeet())]);
    const result = expectOk(await createInterviewEvent(INPUT, { env: ENV, fetchImpl }));
    expect(result.outcome).toBe("conference_pending");
    expect(result.conference).toEqual({ state: "pending", reason: "meet_pending" });
    expect(buildScheduleRowPatch(result).status).toBe("pending");
  });

  it("ignores a hangoutLink that is still marked pending", () => {
    const event = googleEventPendingMeet();
    event["hangoutLink"] = REAL_MEET_LINK;
    expect(classifyConference(event)).toEqual({ state: "pending", reason: "meet_pending" });
  });

  it("rejects a non-Meet hangoutLink instead of persisting it", () => {
    expect(
      classifyConference(googleEvent({ hangoutLink: "https://evil.example.com/abc" })),
    ).toEqual({
      state: "pending",
      reason: "meet_link_invalid",
    });
  });

  it("reports Meet creation failure and never marks the row scheduled", async () => {
    const event = googleEvent({
      conferenceData: {
        createRequest: { status: { statusCode: "failure" } },
      },
    });
    delete event["hangoutLink"];
    const { fetchImpl } = googleFetch([jsonResponse(200, event)]);
    const result = expectOk(await createInterviewEvent(INPUT, { env: ENV, fetchImpl }));
    expect(result.outcome).toBe("conference_failed");
    const patch = buildScheduleRowPatch(result);
    expect(patch).toMatchObject({
      status: "failed",
      conference_status: "failure",
      failure_reason: "meet_creation_failed",
    });
    expect("meet_link" in patch).toBe(false);
  });

  it("resolves a pending conference later by re-reading the event from Google", async () => {
    const { fetchImpl, calendarCalls } = googleFetch([
      jsonResponse(200, googleEventPendingMeet()),
      jsonResponse(200, googleEvent()),
    ]);

    const first = expectOk(await getInterviewEvent({ eventId: EVENT_ID }, { env: ENV, fetchImpl }));
    expect(first.outcome).toBe("conference_pending");

    const second = expectOk(
      await resolveInterviewConference({ eventId: EVENT_ID }, { env: ENV, fetchImpl }),
    );
    expect(second.outcome).toBe("conference_ready");
    expect(buildScheduleRowPatch(second)).toMatchObject({
      status: "pending",
    });
    expect("meet_link" in buildScheduleRowPatch(second)).toBe(false);
    expect(buildScheduleRowPatch(second, { invitationsSent: true })).toMatchObject({
      status: "scheduled",
      meet_link: REAL_MEET_LINK,
    });
    expect(calendarCalls().map((c) => c.init.method)).toEqual(["GET", "GET"]);
  });
});

describe("google-calendar: API failures", () => {
  it("classifies 5xx as retryable google_unavailable", async () => {
    const { fetchImpl } = googleFetch([jsonResponse(503, { error: { message: "backend error" } })]);
    const result = await createInterviewEvent(INPUT, { env: ENV, fetchImpl });
    expect(result).toEqual({
      ok: false,
      reason: "google_unavailable",
      retryable: true,
      httpStatus: 503,
    });
  });

  it("classifies 403 rate limit as retryable and other 403 as google_forbidden", async () => {
    const limited = googleFetch([
      jsonResponse(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }),
    ]);
    expect(
      await createInterviewEvent(INPUT, { env: ENV, fetchImpl: limited.fetchImpl }),
    ).toMatchObject({
      ok: false,
      reason: "google_rate_limited",
      retryable: true,
    });

    const forbidden = googleFetch([
      jsonResponse(403, { error: { errors: [{ reason: "forbidden" }] } }),
    ]);
    expect(
      await createInterviewEvent(INPUT, { env: ENV, fetchImpl: forbidden.fetchImpl }),
    ).toMatchObject({
      ok: false,
      reason: "google_forbidden",
      retryable: false,
    });
  });

  it("classifies 429 and 400", async () => {
    const r429 = googleFetch([jsonResponse(429, {})]);
    expect(
      await createInterviewEvent(INPUT, { env: ENV, fetchImpl: r429.fetchImpl }),
    ).toMatchObject({
      reason: "google_rate_limited",
      retryable: true,
    });
    const r400 = googleFetch([jsonResponse(400, {})]);
    expect(
      await createInterviewEvent(INPUT, { env: ENV, fetchImpl: r400.fetchImpl }),
    ).toMatchObject({
      reason: "google_bad_request",
      retryable: false,
    });
  });

  it("returns a retryable network error without throwing", async () => {
    const { fetchImpl } = googleFetch(["network-error"]);
    const result = await createInterviewEvent(INPUT, { env: ENV, fetchImpl });
    expect(result).toEqual({ ok: false, reason: "google_network_error", retryable: true });
  });

  it("surfaces an expired/revoked refresh token (OAuth Testing apps expire after 7 days)", async () => {
    const { fetchImpl, calendarCalls } = googleFetch(
      [],
      jsonResponse(400, { error: "invalid_grant" }),
    );
    const result = await createInterviewEvent(INPUT, { env: ENV, fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: "google_auth_revoked", retryable: false });
    expect(calendarCalls()).toHaveLength(0); // Calendar is never called without a token
  });

  it("does not leak provider error text or credentials in failure results", async () => {
    const { fetchImpl } = googleFetch([
      jsonResponse(500, { error: { message: `boom ${ACCESS_TOKEN} seeker@example.com` } }),
    ]);
    const result = await createInterviewEvent(INPUT, { env: ENV, fetchImpl });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(serialized).not.toContain("seeker@example.com");
  });

  it("returns a failure (not a thrown error) when the token endpoint is down", async () => {
    const result = await refreshGoogleAccessToken(
      { clientId: "a", clientSecret: "b", refreshToken: "c", calendarId: "primary" },
      vi.fn(async () => jsonResponse(503, {})) as unknown as typeof fetch,
    );
    expect(result).toMatchObject({ ok: false, reason: "google_unavailable", retryable: true });
  });

  it("makes no Calendar call for invalid input", async () => {
    const { fetchImpl, calls } = googleFetch([]);
    const result = await createInterviewEvent(
      { ...INPUT, seeker: { email: "not-an-email" } },
      { env: ENV, fetchImpl },
    );
    expect(result).toMatchObject({ ok: false, reason: "seeker_email_invalid", retryable: false });
    expect(calls).toHaveLength(0);
  });
});

describe("google-calendar: idempotent retries", () => {
  it("sends the same deterministic event id and conference requestId on every attempt", async () => {
    const bodies: SentEventBody[] = [];
    for (let i = 0; i < 2; i++) {
      const { fetchImpl, calendarCalls } = googleFetch([jsonResponse(200, googleEvent())]);
      await createInterviewEvent(INPUT, { env: ENV, fetchImpl });
      bodies.push(sentBody(calendarCalls()[0]!));
    }
    expect(bodies[0]!.id).toBe(EVENT_ID);
    expect(bodies[1]!.id).toBe(EVENT_ID);
    expect(bodies[0]!.conferenceData?.createRequest.requestId).toBe(
      bodies[1]!.conferenceData?.createRequest.requestId,
    );
    expect(bodies[0]!).not.toHaveProperty("attendees");
  });

  it("reconciles HTTP 409 by reading the existing event instead of creating a duplicate", async () => {
    const { fetchImpl, calendarCalls } = googleFetch([
      jsonResponse(409, { error: { errors: [{ reason: "duplicate" }] } }),
      jsonResponse(200, googleEvent()),
    ]);

    const result = expectOk(await createInterviewEvent(INPUT, { env: ENV, fetchImpl }));

    expect(result.alreadyExisted).toBe(true);
    expect(result.outcome).toBe("conference_ready");
    expect(result.event.eventId).toBe(EVENT_ID);
    expect(result.event.meetLink).toBe(REAL_MEET_LINK);
    expect(calendarCalls().map((c) => c.init.method)).toEqual(["POST", "GET"]);
    expect(new URL(calendarCalls()[1]!.url).pathname).toBe(
      `/calendar/v3/calendars/primary/events/${EVENT_ID}`,
    );
  });

  it("a retry after a pending conference picks up the now-available Meet link", async () => {
    // First attempt: event created, Meet still pending.
    const first = googleFetch([jsonResponse(200, googleEventPendingMeet())]);
    const pending = expectOk(
      await createInterviewEvent(INPUT, { env: ENV, fetchImpl: first.fetchImpl }),
    );
    expect(pending.outcome).toBe("conference_pending");

    // Retry: 409 (already exists) -> GET returns the finished conference.
    const retry = googleFetch([jsonResponse(409, {}), jsonResponse(200, googleEvent())]);
    const done = expectOk(
      await createInterviewEvent(INPUT, { env: ENV, fetchImpl: retry.fetchImpl }),
    );
    expect(done.alreadyExisted).toBe(true);
    expect(done.outcome).toBe("conference_ready");
    expect(done.event.meetLink).toBe(REAL_MEET_LINK);
  });

  it("a retry whose existing event is still pending stays pending (never scheduled)", async () => {
    const { fetchImpl } = googleFetch([
      jsonResponse(409, {}),
      jsonResponse(200, googleEventPendingMeet()),
    ]);
    const result = expectOk(await createInterviewEvent(INPUT, { env: ENV, fetchImpl }));
    expect(result.alreadyExisted).toBe(true);
    expect(result.outcome).toBe("conference_pending");
    expect(buildScheduleRowPatch(result).status).toBe("pending");
  });

  it("refuses to reuse a cancelled event id or one that belongs to another interview", async () => {
    const cancelled = googleFetch([
      jsonResponse(409, {}),
      jsonResponse(200, googleEvent({ status: "cancelled" })),
    ]);
    expect(
      await createInterviewEvent(INPUT, { env: ENV, fetchImpl: cancelled.fetchImpl }),
    ).toMatchObject({
      ok: false,
      reason: "google_event_cancelled",
    });

    const foreign = googleFetch([
      jsonResponse(409, {}),
      jsonResponse(
        200,
        googleEvent({
          extendedProperties: {
            private: { hirehub_schedule_id: "99999999-9999-4999-8999-999999999999" },
          },
        }),
      ),
    ]);
    expect(
      await createInterviewEvent(INPUT, { env: ENV, fetchImpl: foreign.fetchImpl }),
    ).toMatchObject({
      ok: false,
      reason: "google_event_id_conflict",
    });
  });

  it("cancel is idempotent: 404/410 mean the event is already gone", async () => {
    const gone = googleFetch([jsonResponse(410, {})]);
    expect(
      await cancelInterviewEvent({ eventId: EVENT_ID }, { env: ENV, fetchImpl: gone.fetchImpl }),
    ).toEqual({
      ok: true,
      alreadyCancelled: true,
    });
    const missing = googleFetch([jsonResponse(404, {})]);
    expect(
      await cancelInterviewEvent({ eventId: EVENT_ID }, { env: ENV, fetchImpl: missing.fetchImpl }),
    ).toEqual({
      ok: true,
      alreadyCancelled: true,
    });
  });
});

describe("google-calendar: reschedule and cancel", () => {
  it("reschedules with PATCH, notifies attendees, and does not request a second conference", async () => {
    const { fetchImpl, calendarCalls } = googleFetch([jsonResponse(200, googleEvent())]);
    const result = expectOk(
      await rescheduleInterviewEvent(
        {
          eventId: EVENT_ID,
          startAt: "2026-11-11T15:00:00+06:00",
          endAt: "2026-11-11T15:30:00+06:00",
          recruiterEmail: "recruiter@example.com",
          seekerEmail: "seeker@example.com",
        },
        { env: ENV, fetchImpl },
      ),
    );

    expect(result.outcome).toBe("conference_ready");
    expect(result.event.meetLink).toBe(REAL_MEET_LINK); // existing real link kept

    const call = calendarCalls()[0]!;
    expect(call.init.method).toBe("PATCH");
    expect(new URL(call.url).searchParams.get("sendUpdates")).toBe("all");
    const sent = JSON.parse(String(call.init.body)) as Record<string, unknown>;
    expect(sent).not.toHaveProperty("conferenceData");
    expect(sent).toMatchObject({
      start: { dateTime: "2026-11-11T15:00:00+06:00", timeZone: "Asia/Dhaka" },
      end: { dateTime: "2026-11-11T15:30:00+06:00", timeZone: "Asia/Dhaka" },
    });
  });

  it("validates reschedule input before calling Google", async () => {
    const { fetchImpl, calls } = googleFetch([]);
    expect(
      await rescheduleInterviewEvent(
        {
          eventId: EVENT_ID,
          startAt: "2026-11-11T15:00:00+06:00",
          endAt: "2026-11-11T14:00:00+06:00",
        },
        { env: ENV, fetchImpl },
      ),
    ).toMatchObject({ ok: false, reason: "invalid_time_range" });
    expect(
      await rescheduleInterviewEvent(
        { eventId: "../evil", startAt: INPUT.startAt, endAt: INPUT.endAt },
        { env: ENV, fetchImpl },
      ),
    ).toMatchObject({ ok: false, reason: "invalid_event_id" });
    expect(calls).toHaveLength(0);
  });

  it("cancels with DELETE and sendUpdates=all", async () => {
    const { fetchImpl, calendarCalls } = googleFetch([jsonResponse(204, null)]);
    const result = await cancelInterviewEvent({ eventId: EVENT_ID }, { env: ENV, fetchImpl });
    expect(result).toEqual({ ok: true, alreadyCancelled: false });
    const call = calendarCalls()[0]!;
    expect(call.init.method).toBe("DELETE");
    expect(new URL(call.url).searchParams.get("sendUpdates")).toBe("all");
  });

  it("reports a retryable failure when cancel hits a 5xx", async () => {
    const { fetchImpl } = googleFetch([jsonResponse(500, {})]);
    expect(
      await cancelInterviewEvent({ eventId: EVENT_ID }, { env: ENV, fetchImpl }),
    ).toMatchObject({
      ok: false,
      reason: "google_unavailable",
      retryable: true,
    });
  });
});

describe("google-calendar: attendee responses", () => {
  it("maps recruiter and seeker RSVP from Google attendees", async () => {
    const { fetchImpl } = googleFetch([
      jsonResponse(
        200,
        googleEventInvited({
          attendees: invitedAttendees("accepted", "declined"),
        }),
      ),
    ]);
    const result = expectOk(
      await getInterviewEvent(
        {
          eventId: EVENT_ID,
          recruiterEmail: "recruiter@example.com",
          seekerEmail: "seeker@example.com",
        },
        { env: ENV, fetchImpl },
      ),
    );
    expect(result.event.recruiterResponse).toBe("accepted");
    expect(result.event.seekerResponse).toBe("declined");
    expect(buildScheduleRowPatch(result)).toMatchObject({
      recruiter_response: "accepted",
      seeker_response: "declined",
    });
  });

  it("maps a cancelled Google event to a cancelled row patch", async () => {
    const { fetchImpl } = googleFetch([jsonResponse(200, googleEvent({ status: "cancelled" }))]);
    const result = expectOk(
      await getInterviewEvent({ eventId: EVENT_ID }, { env: ENV, fetchImpl }),
    );
    expect(buildScheduleRowPatch(result).status).toBe("cancelled");
  });
});

describe("google-calendar: send invitations only after a real Meet link", () => {
  const inviteInput = {
    eventId: EVENT_ID,
    recruiter: INPUT.recruiter,
    seeker: INPUT.seeker,
  };

  it("refuses to invite when Google has not issued hangoutLink", async () => {
    const { fetchImpl, calendarCalls } = googleFetch([jsonResponse(200, googleEventPendingMeet())]);
    const result = await sendInterviewInvitations(inviteInput, { env: ENV, fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: "meet_not_ready", retryable: true });
    expect(calendarCalls().map((c) => c.init.method)).toEqual(["GET"]);
  });

  it("refuses to invite when Meet creation failed", async () => {
    const failed = googleEvent({
      conferenceData: { createRequest: { status: { statusCode: "failure" } } },
    });
    delete failed["hangoutLink"];
    const { fetchImpl, calendarCalls } = googleFetch([jsonResponse(200, failed)]);
    const result = await sendInterviewInvitations(inviteInput, { env: ENV, fetchImpl });
    expect(result).toMatchObject({
      ok: false,
      reason: "meet_creation_failed",
      retryable: false,
    });
    expect(calendarCalls().map((c) => c.init.method)).toEqual(["GET"]);
  });

  it("PATCHes attendees with sendUpdates=all only after the real hangoutLink exists", async () => {
    const { fetchImpl, calendarCalls } = googleFetch([
      jsonResponse(200, googleEvent()),
      jsonResponse(200, googleEventInvited()),
    ]);
    const result = await sendInterviewInvitations(inviteInput, { env: ENV, fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyInvited).toBe(false);
    expect(result.meetLink).toBe(REAL_MEET_LINK);
    expect(result.event.guestEmails).toEqual(["recruiter@example.com", "seeker@example.com"]);

    expect(calendarCalls().map((c) => c.init.method)).toEqual(["GET", "PATCH"]);
    const patch = calendarCalls()[1]!;
    expect(new URL(patch.url).searchParams.get("sendUpdates")).toBe("all");
    const body = sentBody(patch);
    expect(body.attendees?.map((a) => a.email)).toEqual([
      "recruiter@example.com",
      "seeker@example.com",
    ]);
    expect(body).not.toHaveProperty("conferenceData");

    const row = buildInvitedScheduleRowPatch(result);
    expect(row).toMatchObject({
      status: "scheduled",
      conference_status: "success",
      meet_link: REAL_MEET_LINK,
      failure_reason: null,
    });
  });

  it("skips the PATCH when both guests are already present (no duplicate invitations)", async () => {
    const { fetchImpl, calendarCalls } = googleFetch([jsonResponse(200, googleEventInvited())]);
    const result = await sendInterviewInvitations(inviteInput, { env: ENV, fetchImpl });
    expect(result).toMatchObject({ ok: true, alreadyInvited: true, meetLink: REAL_MEET_LINK });
    expect(calendarCalls().map((c) => c.init.method)).toEqual(["GET"]);
  });
});

describe("google-calendar: conference retry on the same event", () => {
  it("PATCHes a new createRequest on the same event with sendUpdates=none", async () => {
    const failed = googleEvent({
      conferenceData: { createRequest: { status: { statusCode: "failure" } } },
    });
    delete failed["hangoutLink"];
    const { fetchImpl, calendarCalls } = googleFetch([
      jsonResponse(200, failed),
      jsonResponse(200, googleEvent()),
    ]);
    const result = expectOk(
      await requestConferenceRetry(
        { eventId: EVENT_ID, scheduleId: SCHEDULE_ID, attempt: 2 },
        { env: ENV, fetchImpl },
      ),
    );
    expect(result.outcome).toBe("conference_ready");
    expect(calendarCalls().map((c) => c.init.method)).toEqual(["GET", "PATCH"]);
    const patch = calendarCalls()[1]!;
    expect(new URL(patch.url).searchParams.get("sendUpdates")).toBe("none");
    expect(new URL(patch.url).searchParams.get("conferenceDataVersion")).toBe("1");
    const body = sentBody(patch);
    expect(body.conferenceData?.createRequest.requestId).toBe(
      interviewConferenceRequestId(SCHEDULE_ID, 2),
    );
    expect(body).not.toHaveProperty("attendees");
  });

  it("is a no-op PATCH when Meet is already ready", async () => {
    const { fetchImpl, calendarCalls } = googleFetch([jsonResponse(200, googleEvent())]);
    const result = expectOk(
      await requestConferenceRetry(
        { eventId: EVENT_ID, scheduleId: SCHEDULE_ID, attempt: 2 },
        { env: ENV, fetchImpl },
      ),
    );
    expect(result.outcome).toBe("conference_ready");
    expect(calendarCalls().map((c) => c.init.method)).toEqual(["GET"]);
  });

  it("refuses to retry Meet after guests were invited", async () => {
    const { fetchImpl, calendarCalls } = googleFetch([jsonResponse(200, googleEventInvited())]);
    const result = await requestConferenceRetry(
      { eventId: EVENT_ID, scheduleId: SCHEDULE_ID, attempt: 2 },
      { env: ENV, fetchImpl },
    );
    expect(result).toMatchObject({ ok: false, reason: "google_already_invited" });
    expect(calendarCalls().map((c) => c.init.method)).toEqual(["GET"]);
  });

  it("rejects attempt 1 (retries start at 2)", async () => {
    const { fetchImpl, calls } = googleFetch([]);
    expect(
      await requestConferenceRetry(
        { eventId: EVENT_ID, scheduleId: SCHEDULE_ID, attempt: 1 },
        { env: ENV, fetchImpl },
      ),
    ).toMatchObject({ ok: false, reason: "invalid_conference_attempt" });
    expect(calls).toHaveLength(0);
  });
});

describe("google-calendar: discard uninvited event", () => {
  it("deletes with sendUpdates=none when there are no guest attendees", async () => {
    const { fetchImpl, calendarCalls } = googleFetch([
      jsonResponse(200, googleEvent()),
      jsonResponse(204, null),
    ]);
    const result = await discardUninvitedEvent({ eventId: EVENT_ID }, { env: ENV, fetchImpl });
    expect(result).toEqual({ ok: true, alreadyDiscarded: false });
    expect(calendarCalls().map((c) => c.init.method)).toEqual(["GET", "DELETE"]);
    expect(new URL(calendarCalls()[1]!.url).searchParams.get("sendUpdates")).toBe("none");
  });

  it("refuses to silently delete an event that already has guest attendees", async () => {
    const { fetchImpl, calendarCalls } = googleFetch([jsonResponse(200, googleEventInvited())]);
    const result = await discardUninvitedEvent({ eventId: EVENT_ID }, { env: ENV, fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: "google_event_has_attendees" });
    expect(calendarCalls().map((c) => c.init.method)).toEqual(["GET"]);
  });

  it("treats 404 as already discarded", async () => {
    const { fetchImpl } = googleFetch([jsonResponse(404, {})]);
    expect(await discardUninvitedEvent({ eventId: EVENT_ID }, { env: ENV, fetchImpl })).toEqual({
      ok: true,
      alreadyDiscarded: true,
    });
  });
});
