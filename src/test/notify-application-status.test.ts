import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, select, eqStatus, eqId, update, from } = vi.hoisted(() => ({
  invoke: vi.fn(),
  select: vi.fn(),
  eqStatus: vi.fn(),
  eqId: vi.fn(),
  update: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke },
    from,
  },
}));

import {
  applicationStatusDedupeKey,
  buildDeliveredNotificationResult,
  isAuthorizedApplicationNotifier,
  NotifyApplicationStatusError,
  parseNotifyApplicationStatusBody,
  requestApplicationStatusNotification,
  updateApplicationStatusWithNotification,
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

describe("applicationStatusDedupeKey", () => {
  it("matches Edge Function + trigger format for idempotent retries", () => {
    expect(applicationStatusDedupeKey("11111111-1111-4111-8111-111111111111", "shortlisted")).toBe(
      "application_status:11111111-1111-4111-8111-111111111111:shortlisted",
    );
  });
});

describe("buildDeliveredNotificationResult", () => {
  it("marks delivery as delivered", () => {
    const result = buildDeliveredNotificationResult({
      applicationId: "11111111-1111-4111-8111-111111111111",
      status: "interview",
      seekerId: "44444444-4444-4444-8444-444444444444",
      jobId: "55555555-5555-4555-8555-555555555555",
      jobTitle: "Engineer",
    });
    expect(result.ok).toBe(true);
    expect(result.delivered).toBe(true);
    expect(result.deliveryStatus).toBe("delivered");
    expect(result.reason).toMatch(/in-app notification/i);
  });
});

describe("requestApplicationStatusNotification", () => {
  const applicationId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    invoke.mockReset();
  });

  it("invokes notify-application-status and returns delivered result", async () => {
    const delivered = buildDeliveredNotificationResult({
      applicationId,
      status: "shortlisted",
      seekerId: "44444444-4444-4444-8444-444444444444",
      jobId: "55555555-5555-4555-8555-555555555555",
      jobTitle: "Engineer",
    });
    invoke.mockResolvedValue({ data: delivered, error: null });

    await expect(requestApplicationStatusNotification(applicationId, "shortlisted")).resolves.toEqual(
      delivered,
    );
    expect(invoke).toHaveBeenCalledWith("notify-application-status", {
      body: { applicationId, status: "shortlisted" },
    });
  });

  it("throws when the Edge Function invoke fails", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "FunctionsRelayError" } });

    await expect(requestApplicationStatusNotification(applicationId, "hired")).rejects.toBeInstanceOf(
      NotifyApplicationStatusError,
    );
  });

  it("throws when delivery is not confirmed", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, delivered: false, deliveryStatus: "pending_provider", reason: "no provider" },
      error: null,
    });

    await expect(requestApplicationStatusNotification(applicationId, "hired")).rejects.toThrow(
      NotifyApplicationStatusError,
    );
  });
});

describe("updateApplicationStatusWithNotification", () => {
  const applicationId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    invoke.mockReset();
    from.mockReset();
    update.mockReset();
    eqId.mockReset();
    eqStatus.mockReset();
    select.mockReset();

    from.mockReturnValue({ update });
    update.mockReturnValue({ eq: eqId });
    eqId.mockReturnValue({ eq: eqStatus });
    eqStatus.mockReturnValue({ select });
  });

  it("updates status then requires a successful notification", async () => {
    select.mockResolvedValue({ data: [{ id: applicationId }], error: null });
    const delivered = buildDeliveredNotificationResult({
      applicationId,
      status: "shortlisted",
      seekerId: "44444444-4444-4444-8444-444444444444",
      jobId: "55555555-5555-4555-8555-555555555555",
      jobTitle: "Engineer",
    });
    invoke.mockResolvedValue({ data: delivered, error: null });

    await expect(
      updateApplicationStatusWithNotification({
        applicationId,
        from: "applied",
        status: "shortlisted",
      }),
    ).resolves.toEqual(delivered);

    expect(from).toHaveBeenCalledWith("applications");
    expect(update).toHaveBeenCalledWith({ status: "shortlisted" });
    expect(invoke).toHaveBeenCalledWith("notify-application-status", {
      body: { applicationId, status: "shortlisted" },
    });
  });

  it("rejects illegal transitions before writing", async () => {
    await expect(
      updateApplicationStatusWithNotification({
        applicationId,
        from: "hired",
        status: "shortlisted",
      }),
    ).rejects.toThrow(/cannot move/i);
    expect(from).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not treat the flow as successful when notification fails after update", async () => {
    select.mockResolvedValue({ data: [{ id: applicationId }], error: null });
    invoke.mockResolvedValue({ data: null, error: { message: "notify failed" } });

    await expect(
      updateApplicationStatusWithNotification({
        applicationId,
        from: "applied",
        status: "rejected",
      }),
    ).rejects.toBeInstanceOf(NotifyApplicationStatusError);
    expect(invoke).toHaveBeenCalled();
  });
});
