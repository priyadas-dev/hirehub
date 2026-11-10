import { describe, expect, it } from "vitest";
import {
  INTERVIEW_MIN_DURATION_MS,
  INTERVIEW_MIN_LEAD_MS,
  isAuthorizedInterviewManager,
  isSchedulableApplicationStatus,
  rejectInterviewIdentityFields,
  validateInterviewAttendees,
  validateInterviewWindow,
} from "@/lib/integrations/interview-authorization";

describe("interview-authorization", () => {
  it("rejects identity fields in the body", () => {
    expect(rejectInterviewIdentityFields({ applicationId: "x" })).toEqual({ ok: true });
    expect(rejectInterviewIdentityFields({ userId: "steal" })).toEqual({
      ok: false,
      code: "identity_fields_forbidden",
    });
  });

  it("allows job owner recruiter and admin to manage interviews", () => {
    expect(
      isAuthorizedInterviewManager({
        callerId: "rec-1",
        callerRole: "recruiter",
        jobRecruiterId: "rec-1",
      }),
    ).toBe(true);
    expect(
      isAuthorizedInterviewManager({
        callerId: "admin-1",
        callerRole: "admin",
        jobRecruiterId: "rec-2",
      }),
    ).toBe(true);
    expect(
      isAuthorizedInterviewManager({
        callerId: "other",
        callerRole: "recruiter",
        jobRecruiterId: "rec-1",
      }),
    ).toBe(false);
    expect(
      isAuthorizedInterviewManager({
        callerId: "seeker-1",
        callerRole: "job_seeker",
        jobRecruiterId: "rec-1",
      }),
    ).toBe(false);
  });

  it("allows only shortlisted and interview application statuses", () => {
    expect(isSchedulableApplicationStatus("shortlisted")).toBe(true);
    expect(isSchedulableApplicationStatus("interview")).toBe(true);
    expect(isSchedulableApplicationStatus("applied")).toBe(false);
  });

  it("validates interview window lead time and duration", () => {
    const now = Date.parse("2026-11-04T10:00:00.000Z");
    const start = new Date(now + INTERVIEW_MIN_LEAD_MS + 60_000).toISOString();
    const end = new Date(
      now + INTERVIEW_MIN_LEAD_MS + INTERVIEW_MIN_DURATION_MS + 60_000,
    ).toISOString();
    expect(validateInterviewWindow({ startAt: start, endAt: end, nowMs: now }).ok).toBe(true);
    expect(
      validateInterviewWindow({
        startAt: new Date(now + 60_000).toISOString(),
        endAt: new Date(now + INTERVIEW_MIN_DURATION_MS + 120_000).toISOString(),
        nowMs: now,
      }),
    ).toMatchObject({ ok: false, code: "start_too_soon" });
  });

  it("requires distinct valid recruiter and seeker emails", () => {
    expect(
      validateInterviewAttendees(
        { email: "recruiter@example.com" },
        { email: "seeker@example.com" },
      ).ok,
    ).toBe(true);
    expect(
      validateInterviewAttendees({ email: "bad" }, { email: "seeker@example.com" }),
    ).toMatchObject({ ok: false, code: "recruiter_email_invalid" });
    expect(
      validateInterviewAttendees({ email: "same@example.com" }, { email: "same@example.com" }),
    ).toMatchObject({ ok: false, code: "attendee_emails_must_differ" });
  });
});
