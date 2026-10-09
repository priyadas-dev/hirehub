import { describe, expect, it } from "vitest";
import {
  buildPendingProviderResult,
  isAuthorizedApplicationNotifier,
  parseNotifyApplicationStatusBody,
} from "@/lib/notify-application-status";

describe("parseNotifyApplicationStatusBody", () => {
  const applicationId = "11111111-1111-4111-8111-111111111111";

  it("accepts a valid applicationId and status", () => {
    expect(parseNotifyApplicationStatusBody({ applicationId, status: "shortlisted" })).toEqual({
      ok: true,
      value: { applicationId, status: "shortlisted" },
    });
  });

  it("rejects identity fields supplied in the body", () => {
    const result = parseNotifyApplicationStatusBody({
      applicationId,
      status: "hired",
      userId: "attacker",
      role: "admin",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/identity/i);
    }
  });

  it("rejects invalid UUIDs and statuses", () => {
    expect(parseNotifyApplicationStatusBody({ applicationId: "nope", status: "hired" }).ok).toBe(
      false,
    );
    expect(
      parseNotifyApplicationStatusBody({ applicationId, status: "pending" }).ok,
    ).toBe(false);
  });
});

describe("isAuthorizedApplicationNotifier", () => {
  const recruiterId = "22222222-2222-4222-8222-222222222222";
  const otherId = "33333333-3333-4333-8333-333333333333";

  it("allows the owning recruiter", () => {
    expect(
      isAuthorizedApplicationNotifier({
        callerId: recruiterId,
        callerRole: "recruiter",
        jobRecruiterId: recruiterId,
      }),
    ).toBe(true);
  });

  it("allows an admin who does not own the job", () => {
    expect(
      isAuthorizedApplicationNotifier({
        callerId: otherId,
        callerRole: "admin",
        jobRecruiterId: recruiterId,
      }),
    ).toBe(true);
  });

  it("denies a seeker or other recruiter", () => {
    expect(
      isAuthorizedApplicationNotifier({
        callerId: otherId,
        callerRole: "job_seeker",
        jobRecruiterId: recruiterId,
      }),
    ).toBe(false);
    expect(
      isAuthorizedApplicationNotifier({
        callerId: otherId,
        callerRole: "recruiter",
        jobRecruiterId: recruiterId,
      }),
    ).toBe(false);
  });
});

describe("buildPendingProviderResult", () => {
  it("marks delivery as pending and not delivered", () => {
    const result = buildPendingProviderResult({
      applicationId: "11111111-1111-4111-8111-111111111111",
      status: "interview",
      seekerId: "44444444-4444-4444-8444-444444444444",
      jobId: "55555555-5555-4555-8555-555555555555",
      jobTitle: "Engineer",
    });
    expect(result.ok).toBe(true);
    expect(result.delivered).toBe(false);
    expect(result.deliveryStatus).toBe("pending_provider");
    expect(result.reason).toMatch(/no email provider|notifications table/i);
  });
});
