import { describe, expect, it, vi } from "vitest";
import type { InterviewAttendee } from "@/lib/integrations/google-calendar";
import { INTERVIEW_SCHEMA_PENDING_CODE } from "@/lib/integrations/interview-schedule-persistence";
import {
  cancelInterviewById,
  retryInterviewScheduleById,
  scheduleInterviewForApplication,
  type InterviewApplicationContext,
  type InterviewScheduleServiceDeps,
} from "@/lib/integrations/interview-schedule.service";
import type {
  InterviewScheduleDbRow,
  InterviewScheduleRepository,
} from "@/lib/integrations/interview-schedule-persistence";
import type { InterviewGoogleClient } from "@/lib/integrations/interview-orchestrator";
import * as orchestrator from "@/lib/integrations/interview-orchestrator";

const SCHEDULE_ID = "3f2b1c4e-8a7d-4e6f-9b1a-0c2d3e4f5a6b";
const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";
const RECRUITER_ID = "22222222-2222-4222-8222-222222222222";
const SEEKER_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-04T10:00:00.000Z");
const START = "2026-11-10T10:00:00+06:00";
const END = "2026-11-10T10:45:00+06:00";

function baseContext(
  overrides: Partial<InterviewApplicationContext> = {},
): InterviewApplicationContext {
  return {
    applicationId: APPLICATION_ID,
    applicationStatus: "shortlisted",
    jobId: "44444444-4444-4444-8444-444444444444",
    jobTitle: "Engineer",
    companyName: "Acme",
    jobRecruiterId: RECRUITER_ID,
    seekerId: SEEKER_ID,
    recruiter: { email: "recruiter@example.com", displayName: "Rita" },
    seeker: { email: "seeker@example.com", displayName: "Sam" },
    ...overrides,
  };
}

function dbRow(overrides: Partial<InterviewScheduleDbRow> = {}): InterviewScheduleDbRow {
  return {
    id: SCHEDULE_ID,
    application_id: APPLICATION_ID,
    job_id: "44444444-4444-4444-8444-444444444444",
    recruiter_id: RECRUITER_ID,
    seeker_id: SEEKER_ID,
    scheduled_by: RECRUITER_ID,
    start_at: START,
    end_at: END,
    timezone: "Asia/Dhaka",
    status: "pending",
    google_calendar_id: null,
    google_event_id: null,
    html_link: null,
    etag: null,
    meet_link: null,
    conference_status: "pending",
    conference_attempt: 1,
    invited_at: null,
    lease_until: null,
    recruiter_response: "needsAction",
    seeker_response: "needsAction",
    reschedule_count: 0,
    failure_reason: null,
    ...overrides,
  };
}

function createRepo(
  overrides: Partial<InterviewScheduleRepository> = {},
): InterviewScheduleRepository {
  return {
    probeReady: vi.fn(async () => true),
    findOpenByApplicationId: vi.fn(async () => null),
    loadById: vi.fn(async () => null),
    insertPending: vi.fn(async () => dbRow()),
    tryAcquireLease: vi.fn(async () => true),
    releaseLease: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    updateTimes: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createDeps(
  repo: InterviewScheduleRepository,
  google: Partial<InterviewGoogleClient> = {},
): InterviewScheduleServiceDeps {
  const g: InterviewGoogleClient = {
    createInterviewEvent: vi.fn(),
    getInterviewEvent: vi.fn(),
    sendInterviewInvitations: vi.fn(),
    requestConferenceRetry: vi.fn(),
    discardUninvitedEvent: vi.fn(),
    cancelInterviewEvent: vi.fn(),
    rescheduleInterviewEvent: vi.fn(),
    ...google,
  };
  return { repository: repo, google: g, now: () => NOW };
}

describe("interview-schedule.service authorization", () => {
  it("denies a recruiter who does not own the job with not_found", async () => {
    const repo = createRepo();
    const result = await scheduleInterviewForApplication({
      callerId: "other-recruiter",
      callerRole: "recruiter",
      context: baseContext(),
      startAt: START,
      endAt: END,
      deps: createDeps(repo),
    });
    expect(result).toMatchObject({ ok: false, code: "not_found" });
    expect(repo.insertPending).not.toHaveBeenCalled();
  });

  it("returns schema_not_ready when the table is missing", async () => {
    const repo = createRepo({ probeReady: vi.fn(async () => false) });
    const result = await scheduleInterviewForApplication({
      callerId: RECRUITER_ID,
      callerRole: "recruiter",
      context: baseContext(),
      startAt: START,
      endAt: END,
      deps: createDeps(repo),
    });
    expect(result).toMatchObject({ ok: false, code: INTERVIEW_SCHEMA_PENDING_CODE });
  });
});

describe("interview-schedule.service scheduling", () => {
  it("inserts a pending row then advances via the orchestrator", async () => {
    const repo = createRepo();
    const advanceSpy = vi.spyOn(orchestrator, "advanceInterview").mockResolvedValue({
      ok: true,
      state: "scheduled",
      scheduleId: SCHEDULE_ID,
    });
    const result = await scheduleInterviewForApplication({
      callerId: RECRUITER_ID,
      callerRole: "recruiter",
      context: baseContext(),
      startAt: START,
      endAt: END,
      deps: createDeps(repo),
    });
    expect(result).toMatchObject({ ok: true, state: "scheduled", scheduleId: SCHEDULE_ID });
    expect(repo.insertPending).toHaveBeenCalledTimes(1);
    expect(advanceSpy).toHaveBeenCalledTimes(1);
    advanceSpy.mockRestore();
  });

  it("resumes an open pending row instead of inserting again", async () => {
    const existing = dbRow({ status: "pending" });
    const repo = createRepo({
      findOpenByApplicationId: vi.fn(async () => existing),
    });
    const advanceSpy = vi.spyOn(orchestrator, "advanceInterview").mockResolvedValue({
      ok: true,
      state: "awaiting_meet",
      scheduleId: SCHEDULE_ID,
    });
    await scheduleInterviewForApplication({
      callerId: RECRUITER_ID,
      callerRole: "recruiter",
      context: baseContext(),
      startAt: START,
      endAt: END,
      deps: createDeps(repo),
    });
    expect(repo.insertPending).not.toHaveBeenCalled();
    expect(advanceSpy).toHaveBeenCalledTimes(1);
    advanceSpy.mockRestore();
  });

  it("uses retry_meet intent for failed rows", async () => {
    const repo = createRepo({
      loadById: vi.fn(async () => dbRow({ status: "failed", conference_status: "failure" })),
    });
    const advanceSpy = vi.spyOn(orchestrator, "advanceInterview").mockResolvedValue({
      ok: true,
      state: "scheduled",
      scheduleId: SCHEDULE_ID,
    });
    await retryInterviewScheduleById({
      callerId: RECRUITER_ID,
      callerRole: "recruiter",
      scheduleId: SCHEDULE_ID,
      context: baseContext(),
      deps: createDeps(repo),
    });
    expect(advanceSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ intent: "retry_meet" }),
    );
    advanceSpy.mockRestore();
  });

  it("cancel delegates to orchestrator cancelInterview", async () => {
    const repo = createRepo({
      loadById: vi.fn(async () =>
        dbRow({
          status: "scheduled",
          meet_link: "https://meet.google.com/x",
          invited_at: NOW.toISOString(),
        }),
      ),
    });
    const cancelSpy = vi.spyOn(orchestrator, "cancelInterview").mockResolvedValue({
      ok: true,
      state: "cancelled",
      notifiedAttendees: true,
      scheduleId: SCHEDULE_ID,
    });
    const result = await cancelInterviewById({
      callerId: RECRUITER_ID,
      callerRole: "recruiter",
      scheduleId: SCHEDULE_ID,
      context: baseContext(),
      deps: createDeps(repo),
    });
    expect(result).toMatchObject({ ok: true, state: "cancelled" });
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    cancelSpy.mockRestore();
  });
});
