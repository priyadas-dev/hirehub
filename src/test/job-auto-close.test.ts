import { describe, expect, it } from "vitest";
import {
  JOB_AUTO_CLOSE_DELIVERY,
  JOB_CLOSED_REASON_SUPPORT,
  buildCloseExpiredJobsResult,
  isEligibleForAutoClose,
  isServiceRoleExpiryCloseAllowed,
  isValidCronSecret,
  selectJobsToAutoClose,
} from "@/lib/job-auto-close";

describe("isEligibleForAutoClose", () => {
  const now = new Date("2026-10-23T12:00:00+06:00");

  it("closes approved jobs whose deadline is before Dhaka today", () => {
    expect(
      isEligibleForAutoClose({ status: "approved", application_deadline: "2026-10-22" }, now),
    ).toBe(true);
  });

  it("skips null deadlines, non-approved, and not-yet-expired", () => {
    expect(isEligibleForAutoClose({ status: "approved", application_deadline: null }, now)).toBe(
      false,
    );
    expect(
      isEligibleForAutoClose({ status: "pending", application_deadline: "2026-10-01" }, now),
    ).toBe(false);
    expect(
      isEligibleForAutoClose({ status: "closed", application_deadline: "2026-10-01" }, now),
    ).toBe(false);
    expect(
      isEligibleForAutoClose({ status: "approved", application_deadline: "2026-10-23" }, now),
    ).toBe(false);
    expect(
      isEligibleForAutoClose({ status: "approved", application_deadline: "2026-10-24" }, now),
    ).toBe(false);
  });
});

describe("isServiceRoleExpiryCloseAllowed", () => {
  const now = new Date("2026-10-23T12:00:00+06:00");

  it("allows only service_role approved→closed with a past deadline", () => {
    expect(
      isServiceRoleExpiryCloseAllowed({
        jwtRole: "service_role",
        oldStatus: "approved",
        newStatus: "closed",
        applicationDeadline: "2026-10-01",
        now,
      }),
    ).toBe(true);
  });

  it("rejects authenticated JWT, other transitions, and future deadlines", () => {
    expect(
      isServiceRoleExpiryCloseAllowed({
        jwtRole: "authenticated",
        oldStatus: "approved",
        newStatus: "closed",
        applicationDeadline: "2026-10-01",
        now,
      }),
    ).toBe(false);
    expect(
      isServiceRoleExpiryCloseAllowed({
        jwtRole: "service_role",
        oldStatus: "closed",
        newStatus: "approved",
        applicationDeadline: "2026-12-01",
        now,
      }),
    ).toBe(false);
    expect(
      isServiceRoleExpiryCloseAllowed({
        jwtRole: "service_role",
        oldStatus: "approved",
        newStatus: "closed",
        applicationDeadline: "2026-10-23",
        now,
      }),
    ).toBe(false);
    expect(
      isServiceRoleExpiryCloseAllowed({
        jwtRole: "service_role",
        oldStatus: "approved",
        newStatus: "closed",
        applicationDeadline: null,
        now,
      }),
    ).toBe(false);
  });
});

describe("selectJobsToAutoClose", () => {
  it("returns only eligible rows and is idempotent on already-closed", () => {
    const now = new Date("2026-10-23T12:00:00+06:00");
    const jobs = [
      { id: "1", status: "approved", application_deadline: "2026-10-01" },
      { id: "2", status: "approved", application_deadline: "2026-12-01" },
      { id: "3", status: "closed", application_deadline: "2026-10-01" },
      { id: "4", status: "approved", application_deadline: null },
    ];
    const first = selectJobsToAutoClose(jobs, now);
    expect(first.map((j) => j.id)).toEqual(["1"]);
    const afterClose = selectJobsToAutoClose(
      jobs.map((j) => (j.id === "1" ? { ...j, status: "closed" } : j)),
      now,
    );
    expect(afterClose).toEqual([]);
  });
});

describe("cron auth, delivery stance, closed-reason limitation", () => {
  it("rejects short or mismatched cron secrets", () => {
    expect(isValidCronSecret("short", "short")).toBe(false);
    expect(isValidCronSecret("a".repeat(16), "b".repeat(16))).toBe(false);
    expect(isValidCronSecret("cron-secret-value-1", "cron-secret-value-1")).toBe(true);
  });

  it("keeps auto-close off the authenticated client path", () => {
    expect(JOB_AUTO_CLOSE_DELIVERY.clientMayInvoke).toBe(false);
    expect(JOB_AUTO_CLOSE_DELIVERY.rpcName).toBe("close_expired_approved_jobs");
    expect(JOB_AUTO_CLOSE_DELIVERY.protectPath).toBe("service_role_jwt_expired_deadline");
    expect(buildCloseExpiredJobsResult(2).closedCount).toBe(2);
  });

  it("documents closed_reason support lands with PROPOSED_0014", () => {
    expect(JOB_CLOSED_REASON_SUPPORT.codeSupportsClosedReason).toBe(true);
    expect(JOB_CLOSED_REASON_SUPPORT.proposedMigration).toMatch(/0014/);
  });
});
