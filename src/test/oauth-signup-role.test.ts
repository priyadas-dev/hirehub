import { afterEach, describe, expect, it } from "vitest";
import {
  buildGoogleOAuthRedirectTo,
  clearOAuthSignupRole,
  GOOGLE_OAUTH_CALLBACK_VALUE,
  GOOGLE_OAUTH_SIGNIN_VALUE,
  markOAuthSignInAttempt,
  markOAuthSignInHandled,
  OAUTH_SIGNIN_ATTEMPT_KEY,
  peekOAuthSignInAttempt,
  peekOAuthSignInHandled,
  shouldDiscardUnregisteredGoogleSignIn,
  UNREGISTERED_GOOGLE_SIGNIN_WINDOW_MS,
  isSupabaseServiceRoleConfigured,
  isWithinOAuthSignupClaimWindow,
  OAUTH_SIGNUP_ROLE_CLAIM_WINDOW_MS,
  OAUTH_SIGNUP_ROLE_STORAGE_KEY,
  oauthSignupRoleSkipReason,
  parseSignupRole,
  peekOAuthSignupRole,
  planPostGoogleAuth,
  resetGoogleOAuthLoadingFlags,
  resolveOAuthReturnRole,
  resolvePendingOAuthSignupRole,
  shouldApplyOAuthSignupRole,
  stashOAuthSignupRole,
  takeOAuthSignupRole,
  withTimeout,
} from "@/lib/oauth-signup-role";

describe("parseSignupRole", () => {
  it("accepts only public signup roles and never admin", () => {
    expect(parseSignupRole("job_seeker")).toBe("job_seeker");
    expect(parseSignupRole("recruiter")).toBe("recruiter");
    expect(parseSignupRole("admin")).toBeUndefined();
    expect(parseSignupRole(undefined)).toBeUndefined();
  });
});

describe("buildGoogleOAuthRedirectTo", () => {
  const origin = "http://localhost:8080";

  it("embeds recruiter signup role so it survives the Google redirect", () => {
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
    expect(url.searchParams.get("oauth")).toBe(GOOGLE_OAUTH_CALLBACK_VALUE);
    expect(url.searchParams.get("redirect")).toBe("/recruiter/jobs");
  });

  it("embeds job_seeker signup as seeker intent", () => {
    const url = new URL(
      buildGoogleOAuthRedirectTo({ origin, mode: "signup", role: "job_seeker" }),
    );
    expect(url.searchParams.get("intent")).toBe("seeker");
    expect(url.searchParams.get("mode")).toBe("signup");
    expect(url.searchParams.get("oauth")).toBe(GOOGLE_OAUTH_CALLBACK_VALUE);
  });

  it("marks sign-in without embedding a role, even if a signup role is passed", () => {
    const url = new URL(
      buildGoogleOAuthRedirectTo({ origin, mode: "signin", role: "recruiter" }),
    );
    expect(url.searchParams.get("mode")).toBeNull();
    expect(url.searchParams.get("intent")).toBeNull();
    expect(url.searchParams.get("oauth")).toBe("signin");
  });

  it("never puts admin on the Google signup callback", () => {
    const url = new URL(
      buildGoogleOAuthRedirectTo({ origin, mode: "signup", role: "admin" as "recruiter" }),
    );
    expect(url.searchParams.get("intent")).not.toBe("admin");
    expect(url.searchParams.get("intent")).toBe("seeker");
  });
});

describe("oauth signup role storage", () => {
  afterEach(() => {
    clearOAuthSignupRole();
  });

  it("stashes recruiter across peek without consuming", () => {
    stashOAuthSignupRole("recruiter");
    expect(peekOAuthSignupRole()).toBe("recruiter");
    expect(peekOAuthSignupRole()).toBe("recruiter");
    expect(sessionStorage.getItem(OAUTH_SIGNUP_ROLE_STORAGE_KEY)).toBe("recruiter");
  });

  it("consumes the stashed role once via take", () => {
    stashOAuthSignupRole("job_seeker");
    expect(takeOAuthSignupRole()).toBe("job_seeker");
    expect(takeOAuthSignupRole()).toBeUndefined();
  });
});

describe("resolvePendingOAuthSignupRole", () => {
  it("prefers stashed recruiter over URL seeker intent", () => {
    expect(
      resolvePendingOAuthSignupRole({
        stashedRole: "recruiter",
        intent: "seeker",
        mode: "signup",
      }),
    ).toBe("recruiter");
  });

  it("falls back to signup URL intent for recruiter and seeker", () => {
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

  it("ignores stash and URL intent on an explicit sign-in return", () => {
    expect(
      resolvePendingOAuthSignupRole({
        stashedRole: "recruiter",
        intent: "recruiter",
        mode: "signin",
      }),
    ).toBeUndefined();
    expect(
      resolvePendingOAuthSignupRole({
        stashedRole: undefined,
        intent: "seeker",
        mode: "signin",
      }),
    ).toBeUndefined();
  });
});

describe("resolveOAuthReturnRole", () => {
  it("keeps a stashed recruiter when the provider drops query params", () => {
    expect(
      resolveOAuthReturnRole({
        stashedRole: "recruiter",
        intent: undefined,
        searchMode: undefined,
        oauth: undefined,
      }),
    ).toBe("recruiter");
  });

  it("uses the signup callback intent when storage is empty", () => {
    expect(
      resolveOAuthReturnRole({
        stashedRole: undefined,
        intent: "recruiter",
        searchMode: "signup",
        oauth: "google",
      }),
    ).toBe("recruiter");
    expect(
      resolveOAuthReturnRole({
        stashedRole: undefined,
        intent: "seeker",
        searchMode: "signup",
        oauth: "google",
      }),
    ).toBe("job_seeker");
  });

  it("does not treat a marketing intent or a sign-in URL as a role claim", () => {
    expect(
      resolveOAuthReturnRole({
        stashedRole: undefined,
        intent: "recruiter",
        searchMode: undefined,
        oauth: undefined,
      }),
    ).toBeUndefined();
    expect(
      resolveOAuthReturnRole({
        stashedRole: undefined,
        intent: "recruiter",
        searchMode: "signup",
        oauth: undefined,
      }),
    ).toBeUndefined();
    expect(
      resolveOAuthReturnRole({
        stashedRole: undefined,
        intent: "recruiter",
        searchMode: undefined,
        oauth: "google",
      }),
    ).toBeUndefined();
  });

  it("prefers the stashed signup role over a conflicting callback intent", () => {
    expect(
      resolveOAuthReturnRole({
        stashedRole: "recruiter",
        intent: "seeker",
        searchMode: "signup",
        oauth: "google",
      }),
    ).toBe("recruiter");
  });
});

describe("shouldDiscardUnregisteredGoogleSignIn", () => {
  const now = Date.parse("2026-10-28T12:00:00.000Z");
  const fresh = new Date(now - 5_000).toISOString();
  const existing = new Date(now - UNREGISTERED_GOOGLE_SIGNIN_WINDOW_MS - 1_000).toISOString();

  const base = {
    oauth: GOOGLE_OAUTH_SIGNIN_VALUE,
    hasGoogleIdentity: true,
    hasEmailIdentity: false,
    currentRole: "job_seeker" as const,
    createdAt: fresh,
    nowMs: now,
  };

  afterEach(() => {
    sessionStorage.removeItem(OAUTH_SIGNIN_ATTEMPT_KEY);
    sessionStorage.removeItem("hirehub.oauthSignInHandled");
  });

  it("discards a Google-only seeker created by this sign-in callback", () => {
    expect(shouldDiscardUnregisteredGoogleSignIn(base)).toBe(true);
  });

  it("discards when storage recorded the sign-in attempt and the query flag was dropped", () => {
    expect(
      shouldDiscardUnregisteredGoogleSignIn({
        ...base,
        oauth: undefined,
        signInAttempt: true,
      }),
    ).toBe(true);
  });

  it("keeps an existing Google seeker, recruiter, or admin", () => {
    expect(shouldDiscardUnregisteredGoogleSignIn({ ...base, createdAt: existing })).toBe(false);
    expect(shouldDiscardUnregisteredGoogleSignIn({ ...base, currentRole: "recruiter" })).toBe(false);
    expect(shouldDiscardUnregisteredGoogleSignIn({ ...base, currentRole: "admin" })).toBe(false);
  });

  it("keeps email-linked accounts and sign-up callbacks", () => {
    expect(shouldDiscardUnregisteredGoogleSignIn({ ...base, hasEmailIdentity: true })).toBe(false);
    expect(shouldDiscardUnregisteredGoogleSignIn({ ...base, hasGoogleIdentity: false })).toBe(false);
    expect(shouldDiscardUnregisteredGoogleSignIn({ ...base, hasSignupRole: true })).toBe(false);
    expect(shouldDiscardUnregisteredGoogleSignIn({ ...base, oauth: "google" })).toBe(false);
  });

  it("does not discard the same user twice after the callback was handled", () => {
    expect(
      shouldDiscardUnregisteredGoogleSignIn({
        ...base,
        userId: "user-1",
        handledUserId: "user-1",
      }),
    ).toBe(false);
  });

  it("records a sign-in attempt without a signup role", () => {
    markOAuthSignInAttempt();
    expect(peekOAuthSignInAttempt()).toBe(true);
    markOAuthSignInHandled("user-1");
    expect(peekOAuthSignInHandled()).toBe("user-1");
    markOAuthSignInAttempt();
    expect(peekOAuthSignInHandled()).toBeUndefined();
  });
});

describe("shouldApplyOAuthSignupRole / existing account preservation", () => {
  const now = Date.parse("2026-10-28T12:00:00.000Z");

  it("applies recruiter for a fresh Google user still on job_seeker", () => {
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

  it("does not apply when UI selected job_seeker (trigger default stands)", () => {
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

  it("never promotes an existing (older) job_seeker Google account", () => {
    expect(
      shouldApplyOAuthSignupRole({
        requestedRole: "recruiter",
        currentRole: "job_seeker",
        userCreatedAt: new Date(now - OAUTH_SIGNUP_ROLE_CLAIM_WINDOW_MS - 1).toISOString(),
        hasGoogleIdentity: true,
        nowMs: now,
      }),
    ).toBe(false);
    expect(
      oauthSignupRoleSkipReason({
        requestedRole: "recruiter",
        currentRole: "job_seeker",
        userCreatedAt: new Date(now - OAUTH_SIGNUP_ROLE_CLAIM_WINDOW_MS - 1).toISOString(),
        hasGoogleIdentity: true,
        nowMs: now,
      }),
    ).toMatch(/already exists as a Job Seeker/i);
  });

  it("ignores email-only accounts", () => {
    expect(
      shouldApplyOAuthSignupRole({
        requestedRole: "recruiter",
        currentRole: "job_seeker",
        userCreatedAt: new Date(now - 60_000).toISOString(),
        hasGoogleIdentity: false,
        nowMs: now,
      }),
    ).toBe(false);
  });
});

describe("planPostGoogleAuth", () => {
  it("claims recruiter only when pending signup role is recruiter", () => {
    expect(planPostGoogleAuth("recruiter")).toBe("claim_recruiter");
    expect(planPostGoogleAuth("job_seeker")).toBe("go_home");
    expect(planPostGoogleAuth(undefined)).toBe("go_home");
  });
});

describe("spinner / loading cleanup helpers", () => {
  it("resets busy and oauthClaiming flags", () => {
    expect(resetGoogleOAuthLoadingFlags()).toEqual({ busy: null, oauthClaiming: false });
  });
});

describe("isSupabaseServiceRoleConfigured", () => {
  it("checks presence only without requiring secret values", () => {
    expect(
      isSupabaseServiceRoleConfigured({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "test-key",
      }),
    ).toBe(true);
    expect(
      isSupabaseServiceRoleConfigured({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "   ",
      }),
    ).toBe(false);
    expect(isSupabaseServiceRoleConfigured({})).toBe(false);
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

describe("withTimeout", () => {
  it("resolves when the promise finishes in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 100, "timed out")).resolves.toBe("ok");
  });

  it("rejects with the timeout message when the promise hangs (failed claim / hung OAuth)", async () => {
    const hang = new Promise<string>(() => {});
    await expect(withTimeout(hang, 20, "timed out")).rejects.toThrow("timed out");
  });
});
