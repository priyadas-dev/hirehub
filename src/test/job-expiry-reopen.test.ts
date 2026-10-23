import { describe, expect, it } from "vitest";
import {
  adminReopenPayload,
  canRecruiterReopenExpiredJob,
  isExpiryAutoClosedJob,
  manualClosePayload,
} from "@/lib/job-expiry-reopen";
import { isServiceRoleExpiryCloseAllowed } from "@/lib/job-auto-close";

const owner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const now = new Date("2026-10-23T12:00:00+06:00");

const expiredClosed = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  status: "closed",
  recruiter_id: owner,
  closed_reason: "expired_deadline" as const,
  application_deadline: "2026-10-01",
};

describe("isExpiryAutoClosedJob", () => {
  it("requires closed + expired_deadline reason", () => {
    expect(isExpiryAutoClosedJob(expiredClosed)).toBe(true);
    expect(isExpiryAutoClosedJob({ status: "closed", closed_reason: "recruiter" })).toBe(false);
    expect(isExpiryAutoClosedJob({ status: "closed", closed_reason: null })).toBe(false);
    expect(isExpiryAutoClosedJob({ status: "approved", closed_reason: "expired_deadline" })).toBe(
      false,
    );
  });
});

describe("canRecruiterReopenExpiredJob", () => {
  it("allows owner reopen of expiry-closed job with future deadline", () => {
    expect(
      canRecruiterReopenExpiredJob({
        job: expiredClosed,
        callerId: owner,
        newDeadline: "2026-11-01",
        now,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects cross-recruiter access", () => {
    const result = canRecruiterReopenExpiredJob({
      job: expiredClosed,
      callerId: other,
      newDeadline: "2026-11-01",
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not your job/i);
  });

  it("rejects manual-close and unknown-reason reopening", () => {
    for (const reason of ["recruiter", "admin", null] as const) {
      const result = canRecruiterReopenExpiredJob({
        job: { ...expiredClosed, closed_reason: reason },
        callerId: owner,
        newDeadline: "2026-11-01",
        now,
      });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects past deadlines and non-closed status", () => {
    expect(
      canRecruiterReopenExpiredJob({
        job: expiredClosed,
        callerId: owner,
        newDeadline: "2026-10-22",
        now,
      }).ok,
    ).toBe(false);
    expect(
      canRecruiterReopenExpiredJob({
        job: { ...expiredClosed, status: "approved" },
        callerId: owner,
        newDeadline: "2026-11-01",
        now,
      }).ok,
    ).toBe(false);
  });
});

describe("close/reopen payloads and auto-close auth", () => {
  it("stamps manual close reasons and clears on admin reopen", () => {
    expect(manualClosePayload("recruiter")).toEqual({
      status: "closed",
      closed_reason: "recruiter",
    });
    expect(manualClosePayload("admin")).toEqual({ status: "closed", closed_reason: "admin" });
    expect(adminReopenPayload()).toEqual({ status: "approved", closed_reason: null });
  });

  it("keeps service_role expiry-close narrowly scoped", () => {
    expect(
      isServiceRoleExpiryCloseAllowed({
        jwtRole: "service_role",
        oldStatus: "approved",
        newStatus: "closed",
        applicationDeadline: "2026-10-01",
        now,
      }),
    ).toBe(true);
    expect(
      isServiceRoleExpiryCloseAllowed({
        jwtRole: "service_role",
        oldStatus: "closed",
        newStatus: "approved",
        applicationDeadline: "2026-11-01",
        now,
      }),
    ).toBe(false);
  });
});
