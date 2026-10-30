import { describe, expect, it, vi } from "vitest";
import {
  applyOAuthRecruiterRoleUpdate,
  type ClaimAdminClient,
} from "@/lib/claim-oauth-signup-role";
import {
  buildEmailSignupMetadata,
  evaluateClaimEligibility,
  isMissingRpcError,
  isRetryableClaimFailure,
  mapClaimRpcStatus,
  userHasGoogleIdentity,
  withOneClaimRetry,
} from "@/lib/oauth-signup-role-claim";

describe("buildEmailSignupMetadata / requested_role path", () => {
  it("embeds requested_role for handle_new_user (recruiter and seeker)", () => {
    expect(buildEmailSignupMetadata({ fullName: "Ada", requestedRole: "recruiter" })).toEqual({
      full_name: "Ada",
      requested_role: "recruiter",
    });
    expect(buildEmailSignupMetadata({ fullName: "Bob", requestedRole: "job_seeker" })).toEqual({
      full_name: "Bob",
      requested_role: "job_seeker",
    });
  });
});

describe("userHasGoogleIdentity", () => {
  it("detects google via identities or app_metadata", () => {
    expect(userHasGoogleIdentity({ identities: [{ provider: "google" }] })).toBe(true);
    expect(userHasGoogleIdentity({ app_metadata: { provider: "google" } })).toBe(true);
    expect(userHasGoogleIdentity({ app_metadata: { providers: ["google"] } })).toBe(true);
    expect(userHasGoogleIdentity({ identities: [{ provider: "email" }] })).toBe(false);
  });
});

describe("mapClaimRpcStatus", () => {
  it("maps applied and skip statuses without promoting admin", () => {
    expect(mapClaimRpcStatus("applied", "job_seeker")).toEqual({
      ok: true,
      applied: true,
      role: "recruiter",
    });
    expect(mapClaimRpcStatus("already_recruiter", "job_seeker").ok).toBe(true);
    expect(mapClaimRpcStatus("outside_claim_window", "job_seeker")).toMatchObject({
      ok: true,
      applied: false,
      role: "job_seeker",
    });
    expect(mapClaimRpcStatus("role_not_eligible", "admin")).toEqual({
      ok: true,
      applied: false,
      role: "admin",
    });
  });

  it("marks profile_missing and update_failed as retryable failures", () => {
    expect(mapClaimRpcStatus("profile_missing", "job_seeker")).toMatchObject({
      ok: false,
      retryable: true,
    });
    expect(mapClaimRpcStatus("update_failed", "job_seeker")).toMatchObject({
      ok: false,
      retryable: true,
    });
  });
});

describe("isRetryableClaimFailure / isMissingRpcError", () => {
  it("retries transient claim failures", () => {
    expect(isRetryableClaimFailure("Only admins can change roles")).toBe(true);
    expect(isRetryableClaimFailure("Your profile is not ready yet")).toBe(true);
    expect(isRetryableClaimFailure("role update did not stick")).toBe(true);
    expect(isRetryableClaimFailure("Invalid login credentials")).toBe(false);
  });

  it("detects missing RPC so UPDATE fallback can run", () => {
    expect(isMissingRpcError("Could not find the function public.claim_oauth_recruiter_role")).toBe(
      true,
    );
    expect(isMissingRpcError("PGRST202")).toBe(true);
    expect(isMissingRpcError("permission denied")).toBe(false);
  });
});

describe("evaluateClaimEligibility", () => {
  const now = Date.parse("2026-10-29T12:00:00.000Z");

  it("applies only for fresh google seeker requesting recruiter", () => {
    expect(
      evaluateClaimEligibility({
        requestedRole: "recruiter",
        currentRole: "job_seeker",
        userCreatedAt: new Date(now - 60_000).toISOString(),
        hasGoogleIdentity: true,
        nowMs: now,
      }).apply,
    ).toBe(true);
  });

  it("skips existing seekers outside the window", () => {
    const result = evaluateClaimEligibility({
      requestedRole: "recruiter",
      currentRole: "job_seeker",
      userCreatedAt: new Date(now - 20 * 60_000).toISOString(),
      hasGoogleIdentity: true,
      nowMs: now,
    });
    expect(result.apply).toBe(false);
    expect(result.skip?.ok).toBe(true);
    expect(result.skip && "applied" in result.skip ? result.skip.applied : true).toBe(false);
  });

  it("never applies for admin, email-only, already-recruiter, or seeker signup request", () => {
    const fresh = new Date(now - 60_000).toISOString();
    expect(
      evaluateClaimEligibility({
        requestedRole: "recruiter",
        currentRole: "admin",
        userCreatedAt: fresh,
        hasGoogleIdentity: true,
        nowMs: now,
      }).apply,
    ).toBe(false);
    expect(
      evaluateClaimEligibility({
        requestedRole: "recruiter",
        currentRole: "job_seeker",
        userCreatedAt: fresh,
        hasGoogleIdentity: false,
        nowMs: now,
      }).apply,
    ).toBe(false);
    expect(
      evaluateClaimEligibility({
        requestedRole: "recruiter",
        currentRole: "recruiter",
        userCreatedAt: fresh,
        hasGoogleIdentity: true,
        nowMs: now,
      }).apply,
    ).toBe(false);
    expect(
      evaluateClaimEligibility({
        requestedRole: "job_seeker",
        currentRole: "job_seeker",
        userCreatedAt: fresh,
        hasGoogleIdentity: true,
        nowMs: now,
      }).apply,
    ).toBe(false);
  });

  it("maps RPC statuses so admin is never rewritten to recruiter", () => {
    expect(mapClaimRpcStatus("role_not_eligible", "admin")).toEqual({
      ok: true,
      applied: false,
      role: "admin",
    });
    expect(mapClaimRpcStatus("outside_claim_window", "admin").role).toBe("admin");
    expect(mapClaimRpcStatus("no_google_identity", "admin").role).toBe("admin");
  });
});

describe("withOneClaimRetry", () => {
  it("retries once when the first attempt is retryable", async () => {
    const attempt = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: "profile is not ready", retryable: true })
      .mockResolvedValueOnce({ ok: true, applied: true, role: "recruiter" });
    const result = await withOneClaimRetry(attempt, 1);
    expect(result).toEqual({ ok: true, applied: true, role: "recruiter" });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable failures", async () => {
    const attempt = vi.fn().mockResolvedValue({ ok: false, message: "invalid role" });
    const result = await withOneClaimRetry(attempt, 1);
    expect(result.ok).toBe(false);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

describe("applyOAuthRecruiterRoleUpdate", () => {
  it("uses RPC when available and never deletes profiles", async () => {
    const from = vi.fn();
    const admin: ClaimAdminClient = {
      auth: { admin: { getUserById: vi.fn() } },
      from,
      rpc: vi.fn().mockResolvedValue({ data: "applied", error: null }),
    };
    const result = await applyOAuthRecruiterRoleUpdate(admin, "user-1", "job_seeker");
    expect(result).toEqual({ ok: true, applied: true, role: "recruiter" });
    expect(from).not.toHaveBeenCalled();
  });

  it("falls back to UPDATE when RPC is missing (no delete+insert)", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "user-1", role: "recruiter" }, error: null });
    const updateEq2 = vi.fn().mockResolvedValue({ error: null });
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
    const admin: ClaimAdminClient = {
      auth: { admin: { getUserById: vi.fn() } },
      from: vi.fn().mockReturnValue({
        select: () => ({ eq: () => ({ maybeSingle }) }),
        update: () => ({ eq: updateEq1 }),
      }),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Could not find the function public.claim_oauth_recruiter_role" },
      }),
    };
    const result = await applyOAuthRecruiterRoleUpdate(admin, "user-1", "job_seeker");
    expect(result).toEqual({ ok: true, applied: true, role: "recruiter" });
    expect(updateEq1).toHaveBeenCalledWith("id", "user-1");
    expect(updateEq2).toHaveBeenCalledWith("role", "job_seeker");
  });

  it("fails clearly when role guard blocks UPDATE (no delete fallback)", async () => {
    const admin: ClaimAdminClient = {
      auth: { admin: { getUserById: vi.fn() } },
      from: vi.fn().mockReturnValue({
        select: () => ({ eq: () => ({ maybeSingle: vi.fn() }) }),
        update: () => ({
          eq: () => ({
            eq: vi.fn().mockResolvedValue({ error: { message: "Only admins can change roles" } }),
          }),
        }),
      }),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Could not find the function public.claim_oauth_recruiter_role" },
      }),
    };
    const result = await applyOAuthRecruiterRoleUpdate(admin, "user-1", "job_seeker");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/PROPOSED_0007|PROPOSED_0019|role guard/i);
      expect(result.retryable).toBe(true);
    }
  });
});
