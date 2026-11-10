import { describe, expect, it, vi } from "vitest";
import {
  interviewEventIdFromScheduleId,
  type CancelInterviewResult,
  type ConferenceOutcome,
  type DiscardUninvitedResult,
  type InterviewEventSnapshot,
  type InterviewEventSuccess,
  type InviteInterviewSuccess,
} from "@/lib/integrations/google-calendar";
import {
  advanceInterview,
  cancelInterview,
  type InterviewGoogleClient,
  type InterviewOrchestratorRow,
  type InterviewOrchestratorStore,
  type InterviewRowWrite,
} from "@/lib/integrations/interview-orchestrator";

const SCHEDULE_ID = "3f2b1c4e-8a7d-4e6f-9b1a-0c2d3e4f5a6b";
const EVENT_ID = interviewEventIdFromScheduleId(SCHEDULE_ID, 1)!;
const EVENT_ID_A3 = interviewEventIdFromScheduleId(SCHEDULE_ID, 3)!;
const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";
const REAL_MEET_LINK = "https://meet.google.com/abc-defg-hij";
const NOW = new Date("2026-11-04T10:00:00.000Z");

function snapshot(
  eventId: string,
  conference: ConferenceOutcome,
  guests: string[] = [],
): InterviewEventSnapshot {
  return {
    eventId,
    calendarStatus: "confirmed",
    htmlLink: "https://www.google.com/calendar/event?eid=abc",
    etag: '"etag1"',
    meetLink: conference.state === "ready" ? conference.meetLink : null,
    conferenceStatus:
      conference.state === "ready"
        ? "success"
        : conference.state === "failed"
          ? "failure"
          : "pending",
    guestEmails: guests,
    recruiterResponse: guests.length ? "needsAction" : null,
    seekerResponse: guests.length ? "needsAction" : null,
    scheduleIdProperty: SCHEDULE_ID,
  };
}

function googleSuccess(
  outcome: InterviewEventSuccess["outcome"],
  eventId = EVENT_ID,
  guests: string[] = [],
): InterviewEventSuccess {
  const conference: ConferenceOutcome =
    outcome === "conference_ready"
      ? { state: "ready", meetLink: REAL_MEET_LINK }
      : outcome === "conference_failed"
        ? { state: "failed", reason: "meet_creation_failed" }
        : { state: "pending", reason: "meet_pending" };
  return {
    ok: true,
    outcome,
    event: snapshot(eventId, conference, guests),
    conference,
    alreadyExisted: false,
    calendarId: "primary",
  };
}

function inviteSuccess(alreadyInvited: boolean, eventId = EVENT_ID): InviteInterviewSuccess {
  const guests = ["recruiter@example.com", "seeker@example.com"];
  return {
    ok: true,
    alreadyInvited,
    event: snapshot(eventId, { state: "ready", meetLink: REAL_MEET_LINK }, guests),
    meetLink: REAL_MEET_LINK,
    calendarId: "primary",
  };
}

function baseRow(overrides: Partial<InterviewOrchestratorRow> = {}): InterviewOrchestratorRow {
  return {
    id: SCHEDULE_ID,
    applicationId: APPLICATION_ID,
    jobTitle: "Senior Backend Engineer",
    companyName: "Acme",
    startAt: "2026-11-10T10:00:00+06:00",
    endAt: "2026-11-10T10:45:00+06:00",
    timezone: "Asia/Dhaka",
    status: "pending",
    googleEventId: null,
    googleCalendarId: null,
    htmlLink: null,
    etag: null,
    meetLink: null,
    conferenceStatus: "pending",
    conferenceAttempt: 1,
    invitedAt: null,
    recruiter: { email: "recruiter@example.com", displayName: "Rita" },
    seeker: { email: "seeker@example.com", displayName: "Sam" },
    ...overrides,
  };
}

type FakeStore = InterviewOrchestratorStore & {
  row: InterviewOrchestratorRow;
  patches: InterviewRowWrite[];
  leaseHeld: boolean;
  saveImpl?: (patch: InterviewRowWrite) => Promise<void>;
};

function createStore(row: InterviewOrchestratorRow, acquire = true): FakeStore {
  const store: FakeStore = {
    row: { ...row },
    patches: [],
    leaseHeld: false,
    async tryAcquireLease() {
      if (!acquire) return false;
      if (store.leaseHeld) return false;
      store.leaseHeld = true;
      return true;
    },
    async releaseLease() {
      store.leaseHeld = false;
    },
    async save(_id, patch) {
      store.patches.push(patch);
      if (store.saveImpl) await store.saveImpl(patch);
      store.row = {
        ...store.row,
        status: patch.status ?? store.row.status,
        googleEventId:
          patch.googleEventId === undefined ? store.row.googleEventId : patch.googleEventId,
        meetLink: patch.meetLink === undefined ? store.row.meetLink : patch.meetLink,
        invitedAt: patch.invitedAt === undefined ? store.row.invitedAt : patch.invitedAt,
        conferenceStatus: patch.conferenceStatus ?? store.row.conferenceStatus,
        conferenceAttempt: patch.conferenceAttempt ?? store.row.conferenceAttempt,
      };
    },
  };
  return store;
}

function createGoogle(overrides: Partial<InterviewGoogleClient> = {}) {
  const create = vi.fn(async () => googleSuccess("conference_ready"));
  const get = vi.fn(async () => googleSuccess("conference_ready"));
  const invite = vi.fn(async (input: { eventId: string }) => inviteSuccess(false, input.eventId));
  const retry = vi.fn(async () => googleSuccess("conference_ready"));
  const discard = vi.fn(async (): Promise<DiscardUninvitedResult> => ({
    ok: true,
    alreadyDiscarded: false,
  }));
  const cancel = vi.fn(async (): Promise<CancelInterviewResult> => ({
    ok: true,
    alreadyCancelled: false,
  }));
  const reschedule = vi.fn(async () => googleSuccess("conference_ready"));
  const google: InterviewGoogleClient = {
    createInterviewEvent: create,
    getInterviewEvent: get,
    sendInterviewInvitations: invite,
    requestConferenceRetry: retry,
    discardUninvitedEvent: discard,
    cancelInterviewEvent: cancel,
    rescheduleInterviewEvent: reschedule,
    ...overrides,
  };
  return {
    google,
    create: google.createInterviewEvent,
    get: google.getInterviewEvent,
    invite: google.sendInterviewInvitations,
    retry: google.requestConferenceRetry,
    discard: google.discardUninvitedEvent,
    cancel: google.cancelInterviewEvent,
  };
}

function depsOf(store: FakeStore, google: InterviewGoogleClient) {
  return {
    google,
    store,
    now: () => NOW,
    sleep: async () => undefined,
    pollAttempts: 3,
    pollDelayMs: 0,
  };
}

describe("advanceInterview: invite only after a real Meet link", () => {
  it("creates once, invites after the link, and persists scheduled with the real hangoutLink", async () => {
    const store = createStore(baseRow());
    const { google, create, invite, get } = createGoogle();
    const result = await advanceInterview(baseRow(), depsOf(store, google));

    expect(result).toEqual({ ok: true, state: "scheduled", scheduleId: SCHEDULE_ID });
    expect(create).toHaveBeenCalledTimes(1);
    expect(invite).toHaveBeenCalledTimes(1);
    expect(invite).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      recruiter: expect.objectContaining({ email: "recruiter@example.com" }),
      seeker: expect.objectContaining({ email: "seeker@example.com" }),
    });
    expect(get).not.toHaveBeenCalled(); // conference was ready on create — no poll
    expect(store.row).toMatchObject({
      status: "scheduled",
      meetLink: REAL_MEET_LINK,
      invitedAt: NOW.toISOString(),
      googleEventId: EVENT_ID,
      conferenceStatus: "success",
    });
    const eventSavedBeforeInvite = store.patches.find((p) => p.googleEventId === EVENT_ID);
    expect(eventSavedBeforeInvite).toBeDefined();
  });

  it("does not invite while Meet is pending; returns awaiting_meet", async () => {
    const store = createStore(baseRow());
    const { google, create, invite, get } = createGoogle({
      createInterviewEvent: vi.fn(async () => googleSuccess("conference_pending")),
      getInterviewEvent: vi.fn(async () => googleSuccess("conference_pending")),
    });
    const result = await advanceInterview(baseRow(), depsOf(store, google));

    expect(result).toEqual({ ok: true, state: "awaiting_meet", scheduleId: SCHEDULE_ID });
    expect(create).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(3);
    expect(invite).not.toHaveBeenCalled();
    expect(store.row.status).toBe("pending");
    expect(store.row.meetLink).toBeNull();
    expect(store.row.invitedAt).toBeNull();
    expect(store.row.googleEventId).toBe(EVENT_ID);
  });

  it("polls a pending conference then invites only after the real link appears", async () => {
    const store = createStore(baseRow());
    const gets = [googleSuccess("conference_pending"), googleSuccess("conference_ready")];
    const { google, invite } = createGoogle({
      createInterviewEvent: vi.fn(async () => googleSuccess("conference_pending")),
      getInterviewEvent: vi.fn(async () => gets.shift() ?? googleSuccess("conference_ready")),
    });
    const result = await advanceInterview(baseRow(), depsOf(store, google));

    expect(result).toMatchObject({ ok: true, state: "scheduled" });
    expect(invite).toHaveBeenCalledTimes(1);
    expect(store.row.meetLink).toBe(REAL_MEET_LINK);
  });

  it("marks failed and never invites when Meet creation fails", async () => {
    const store = createStore(baseRow());
    const { google, invite } = createGoogle({
      createInterviewEvent: vi.fn(async () => googleSuccess("conference_failed")),
    });
    const result = await advanceInterview(baseRow(), depsOf(store, google));

    expect(result).toMatchObject({ ok: false, code: "meet_creation_failed", retryable: false });
    expect(invite).not.toHaveBeenCalled();
    expect(store.row.status).toBe("failed");
    expect(store.row.meetLink).toBeNull();
  });
});

describe("advanceInterview: retry ladder", () => {
  it("attempt 2 PATCHes the same event and invites after Meet succeeds", async () => {
    const row = baseRow({
      status: "failed",
      googleEventId: EVENT_ID,
      conferenceAttempt: 1,
      conferenceStatus: "failure",
    });
    const store = createStore(row);
    const { google, create, retry, invite, discard } = createGoogle({
      requestConferenceRetry: vi.fn(async () => googleSuccess("conference_ready")),
    });
    const result = await advanceInterview(row, depsOf(store, google), { intent: "retry_meet" });

    expect(result).toMatchObject({ ok: true, state: "scheduled" });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith({ eventId: EVENT_ID, scheduleId: SCHEDULE_ID, attempt: 2 });
    expect(create).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
    expect(invite).toHaveBeenCalledTimes(1);
    expect(store.row.conferenceAttempt).toBe(2);
  });

  it("attempt 3 discards the never-invited event and recreates under a new event id", async () => {
    const row = baseRow({
      status: "failed",
      googleEventId: EVENT_ID,
      conferenceAttempt: 2,
      conferenceStatus: "failure",
    });
    const store = createStore(row);
    const { google, create, retry, discard, invite } = createGoogle({
      createInterviewEvent: vi.fn(async (input) => {
        expect(input.conferenceAttempt).toBe(3);
        return googleSuccess("conference_ready", EVENT_ID_A3);
      }),
      sendInterviewInvitations: vi.fn(async (input) => inviteSuccess(false, input.eventId)),
    });
    const result = await advanceInterview(row, depsOf(store, google), { intent: "retry_meet" });

    expect(result).toMatchObject({ ok: true, state: "scheduled" });
    expect(discard).toHaveBeenCalledWith({ eventId: EVENT_ID });
    expect(create).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(invite).toHaveBeenCalledWith(expect.objectContaining({ eventId: EVENT_ID_A3 }));
    expect(store.row.conferenceAttempt).toBe(3);
    expect(store.row.googleEventId).toBe(EVENT_ID_A3);
  });

  it("refuses a fourth Meet retry", async () => {
    const row = baseRow({
      status: "failed",
      googleEventId: EVENT_ID_A3,
      conferenceAttempt: 3,
    });
    const store = createStore(row);
    const { google, create, retry, invite } = createGoogle();
    const result = await advanceInterview(row, depsOf(store, google), { intent: "retry_meet" });
    expect(result).toMatchObject({ ok: false, code: "meet_attempts_exhausted" });
    expect(create).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    expect(invite).not.toHaveBeenCalled();
  });
});

describe("advanceInterview: idempotent retries and crashes", () => {
  it("does not create a second event when advancing a row that already has an event id", async () => {
    const row = baseRow({ googleEventId: EVENT_ID, status: "pending" });
    const store = createStore(row);
    const { google, create, get, invite } = createGoogle({
      getInterviewEvent: vi.fn(async () => googleSuccess("conference_ready")),
    });
    await advanceInterview(row, depsOf(store, google));
    expect(create).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(1);
    expect(invite).toHaveBeenCalledTimes(1);
  });

  it("on a second advance after invitations already went out, skips create and invite PATCH", async () => {
    const row = baseRow({ googleEventId: EVENT_ID, status: "pending" });
    const store = createStore(row);
    const { google, create, invite } = createGoogle({
      getInterviewEvent: vi.fn(async () => googleSuccess("conference_ready")),
      sendInterviewInvitations: vi.fn(async () => inviteSuccess(true)),
    });
    const result = await advanceInterview(row, depsOf(store, google));
    expect(result).toMatchObject({ ok: true, state: "scheduled" });
    expect(create).not.toHaveBeenCalled();
    expect(invite).toHaveBeenCalledTimes(1);
    expect(store.row.meetLink).toBe(REAL_MEET_LINK);
  });

  it("a crash between Google invite and DB write does not send a second invitation", async () => {
    const row = baseRow();
    const store = createStore(row);
    let scheduledWrites = 0;
    store.saveImpl = async (patch) => {
      if (patch.status === "scheduled") {
        scheduledWrites += 1;
        if (scheduledWrites === 1) throw new Error("db blip");
      }
    };
    const { google, create, invite } = createGoogle({
      sendInterviewInvitations: vi.fn(async () => inviteSuccess(scheduledWrites >= 1)),
    });
    const deps = depsOf(store, google);

    await expect(advanceInterview(row, deps)).rejects.toThrow("db blip");
    expect(create).toHaveBeenCalledTimes(1);
    expect(invite).toHaveBeenCalledTimes(1);
    expect(store.row.status).toBe("pending");
    expect(store.row.googleEventId).toBe(EVENT_ID);
    expect(store.leaseHeld).toBe(false);

    const second = await advanceInterview(store.row, deps);
    expect(second).toMatchObject({ ok: true, state: "scheduled" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(invite).toHaveBeenCalledTimes(2);
    expect(store.row.status).toBe("scheduled");
    expect(store.row.meetLink).toBe(REAL_MEET_LINK);
  });

  it("returns in_progress when the lease is held and makes no Google calls", async () => {
    const store = createStore(baseRow(), false);
    const { google, create, invite } = createGoogle();
    const result = await advanceInterview(baseRow(), depsOf(store, google));
    expect(result).toEqual({
      ok: false,
      code: "in_progress",
      retryable: true,
      scheduleId: SCHEDULE_ID,
    });
    expect(create).not.toHaveBeenCalled();
    expect(invite).not.toHaveBeenCalled();
  });

  it("is a no-op for an already scheduled interview", async () => {
    const row = baseRow({
      status: "scheduled",
      googleEventId: EVENT_ID,
      meetLink: REAL_MEET_LINK,
      invitedAt: NOW.toISOString(),
      conferenceStatus: "success",
    });
    const { google, create, invite } = createGoogle();
    const result = await advanceInterview(row, depsOf(createStore(row), google));
    expect(result).toEqual({ ok: true, state: "scheduled", scheduleId: SCHEDULE_ID });
    expect(create).not.toHaveBeenCalled();
    expect(invite).not.toHaveBeenCalled();
  });
});

describe("cancelInterview", () => {
  it("discards a never-invited event with sendUpdates=none (no attendee notification)", async () => {
    const row = baseRow({ googleEventId: EVENT_ID, status: "pending" });
    const store = createStore(row);
    const { google, discard, cancel } = createGoogle();
    const result = await cancelInterview(row, depsOf(store, google));
    expect(result).toEqual({
      ok: true,
      state: "cancelled",
      notifiedAttendees: false,
      scheduleId: SCHEDULE_ID,
    });
    expect(discard).toHaveBeenCalledWith({ eventId: EVENT_ID });
    expect(cancel).not.toHaveBeenCalled();
    expect(store.row.status).toBe("cancelled");
  });

  it("notifies attendees when cancelling an invited interview", async () => {
    const row = baseRow({
      googleEventId: EVENT_ID,
      status: "scheduled",
      meetLink: REAL_MEET_LINK,
      invitedAt: NOW.toISOString(),
    });
    const store = createStore(row);
    const { google, discard, cancel } = createGoogle();
    const result = await cancelInterview(row, depsOf(store, google));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notifiedAttendees).toBe(true);
    expect(cancel).toHaveBeenCalledWith({ eventId: EVENT_ID });
    expect(discard).not.toHaveBeenCalled();
  });
});
