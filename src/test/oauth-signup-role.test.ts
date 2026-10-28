import { afterEach, describe, expect, it } from "vitest";
import {
  buildGoogleOAuthRedirectTo,
  clearOAuthSignupRole,
  isWithinOAuthSignupClaimWindow,
  OAUTH_SIGNUP_ROLE_CLAIM_WINDOW_MS,
  OAUTH_SIGNUP_ROLE_STORAGE_KEY,
  parseSignupRole,
  peekOAuthSignupRole,
  resolvePendingOAuthSignupRole,
  shouldApplyOAuthSignupRole,
  stashOAuthSignupRole,
  takeOAuthSignupRole,
} from "@/lib/oauth-signup-role";

describe("parseSignupRole", () => {
  it("accepts only public signup roles", () => {
    expect(parseSignupRole("job_seeker")).toBe("job_seeker");
    expect(parseSignupRole("recruiter")).toBe("recruiter");
    expect(parseSignupRole("admin")).toBeUndefined();
    expect(parseSignupRole(undefined)).toBeUndefined();
  });
});

describe("buildGoogleOAuthRedirectTo", () => {
  const origin = "http://localhost:8080";

  it("embeds signup role as intent so it survives the Google redirect", () => {
    const url = new URL(
      buildGoogleOAuthRedirectTo({
        origin,
        mode: "signup",
        role: "recruiter",
        redirect: "/recruiter/jobs",
      }),
    );
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("mode")).toBe("signup");
    expect(url.searchParams.get("intent")).toBe("recruiter");
    expect(url.searchParams.get("redirect")).toBe("/recruiter/jobs");
  });

  it("maps job_seeker signup to seeker intent", () => {
    const url = new URL(
      buildGoogleOAuthRedirectTo({ origin, mode: "signup", role: "job_seeker" }),
    );
    expect(url.searchParams.get("intent")).toBe("seeker");
    expect(url.searchParams.get("mode")).toBe("signup");
  });

  it("does not attach a role claim intent on sign-in", () => {
    const url = new URL(
      buildGoogleOAuthRedirectTo({ origin, mode: "signin", role: "recruiter" }),
    );
    expect(url.searchParams.get("mode")).toBeNull();
    expect(url.searchParams.get("intent")).toBeNull();
  });

  it("preserves marketing intent on sign-in without treating role UI as authoritative", () => {
    const url = new URL(
      buildGoogleOAuthRedirectTo({
        origin,
        mode: "signin",
        role: "job_seeker",
        intent: "recruiter",
      }),
    );
    expect(url.searchParams.get("intent")).toBe("recruiter");
    expect(url.searchParams.get("mode")).toBeNull();
  });
});

describe("oauth signup role storage", () => {
  afterEach(() => {
    clearOAuthSignupRole();
  });

  it("stashes and consumes the selected role once", () => {
    stashOAuthSignupRole("recruiter");
    expect(sessionStorage.getItem(OAUTH_SIGNUP_ROLE_STORAGE_KEY)).toBe("recruiter");
    expect(peekOAuthSignupRole()).toBe("recruiter");
    expect(takeOAuthSignupRole()).toBe("recruiter");
    expect(takeOAuthSignupRole()).toBeUndefined();
  });
});

describe("resolvePendingOAuthSignupRole", () => {
  it("prefers the stashed role over URL intent", () => {
    expect(
      resolvePendingOAuthSignupRole({
        stashedRole: "recruiter",
        intent: "seeker",
        mode: "signup",
      }),
    ).toBe("recruiter");
  });

  it("falls back to signup URL intent when storage is empty", () => {
    expect(
      resolvePendingOAuthSignupRole({
        stashedRole: undefined,
        intent: "recruiter",
        mode: "signup",
      }),
    ).toBe("recruiter");
    expect(
      resolvePendingOAuthSignupRole({
        stashedRole: undefined,
        intent: "seeker",
        mode: "signup",
      }),
    ).toBe("job_seeker");
  });

  it("ignores URL intent during sign-in so existing roles are not overwritten", () => {
    expect(
      resolvePendingOAuthSignupRole({
        stashedRole: undefined,
        intent: "recruiter",
        mode: "signin",
      }),
    ).toBeUndefined();
  });
});

describe("shouldApplyOAuthSignupRole", () => {
  const now = Date.parse("2026-10-28T12:00:00.000Z");

  it("applies recruiter only for fresh Google users still on job_seeker", () => {
    expect(
      shouldApplyOAuthSignupRole({
        requestedRole: "recruiter",
        currentRole: "job_seeker",
        userCreatedAt: new Date(now - 60_000).toISOString(),
        hasGoogleIdentity: true,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it("never overwrites an existing recruiter or admin role", () => {
    expect(
      shouldApplyOAuthSignupRole({
        requestedRole: "recruiter",
        currentRole: "recruiter",
        userCreatedAt: new Date(now - 60_000).toISOString(),
        hasGoogleIdentity: true,
        nowMs: now,
      }),
    ).toBe(false);
    expect(
      shouldApplyOAuthSignupRole({
        requestedRole: "recruiter",
        currentRole: "admin",
        userCreatedAt: new Date(now - 60_000).toISOString(),
        hasGoogleIdentity: true,
        nowMs: now,
      }),
    ).toBe(false);
  });

  it("ignores email-only accounts and expired claim windows without unused upgrade", () => {
    expect(
      shouldApplyOAuthSignupRole({
        requestedRole: "recruiter",
        currentRole: "job_seeker",
        userCreatedAt: new Date(now - 60_000).toISOString(),
        hasGoogleIdentity: false,
        nowMs: now,
      }),
    ).toBe(false);
    expect(
      shouldApplyOAuthSignupRole({
        requestedRole: "recruiter",
        currentRole: "job_seeker",
        userCreatedAt: new Date(now - OAUTH_SIGNUP_ROLE_CLAIM_WINDOW_MS - 1).toISOString(),
        hasGoogleIdentity: true,
        nowMs: now,
      }),
    ).toBe(false);
  });

  it("allows an unused older Google seeker to claim recruiter when they choose it on signup", () => {
    expect(
      shouldApplyOAuthSignupRole({
        requestedRole: "recruiter",
        currentRole: "job_seeker",
        userCreatedAt: new Date(now - OAUTH_SIGNUP_ROLE_CLAIM_WINDOW_MS - 1).toISOString(),
        hasGoogleIdentity: true,
        unusedSeekerAccount: true,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it("does not apply when the UI selected job_seeker (trigger default stands)", () => {
    expect(
      shouldApplyOAuthSignupRole({
        requestedRole: "job_seeker",
        currentRole: "job_seeker",
        userCreatedAt: new Date(now - 60_000).toISOString(),
        hasGoogleIdentity: true,
        nowMs: now,
      }),
    ).toBe(false);
  });
});

describe("isWithinOAuthSignupClaimWindow", () => {
  it("rejects missing or future timestamps", () => {
    const now = Date.parse("2026-10-28T12:00:00.000Z");
    expect(isWithinOAuthSignupClaimWindow(null, now)).toBe(false);
    expect(isWithinOAuthSignupClaimWindow("not-a-date", now)).toBe(false);
    expect(isWithinOAuthSignupClaimWindow(new Date(now + 5_000).toISOString(), now)).toBe(false);
  });
});
