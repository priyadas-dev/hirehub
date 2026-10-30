import { describe, expect, it } from "vitest";
import {
  GOOGLE_OAUTH_ALLOWLIST_CHECKLIST,
  PASSWORD_RESET_ALLOWLIST_CHECKLIST,
  recruiterClaimRecoveryMessage,
} from "@/lib/auth-recovery";
import { PASSWORD_RESET_REDIRECT_URLS } from "@/lib/assignment-verification";

describe("recruiterClaimRecoveryMessage", () => {
  it("includes continue / sign out / delete paths for claim_failed", () => {
    const msg = recruiterClaimRecoveryMessage("claim_failed", "RPC returned error.");
    expect(msg).toMatch(/RPC returned error/);
    expect(msg).toMatch(/Job Seeker/i);
    expect(msg).toMatch(/Sign up → Recruiter/i);
    expect(msg).toMatch(/Settings/i);
  });

  it("uses a default for role_not_saved", () => {
    expect(recruiterClaimRecoveryMessage("role_not_saved")).toMatch(/Recruiter role was not saved/i);
  });

  it("covers session_not_ready and profile_load_failed", () => {
    expect(recruiterClaimRecoveryMessage("session_not_ready")).toMatch(/session was not ready/i);
    expect(recruiterClaimRecoveryMessage("profile_load_failed")).toMatch(/could not be loaded/i);
  });
});

describe("password reset allowlist checklist", () => {
  it("points operators at PASSWORD_RESET_REDIRECT_URLS and /reset-password", () => {
    expect(PASSWORD_RESET_ALLOWLIST_CHECKLIST.length).toBeGreaterThanOrEqual(4);
    expect(PASSWORD_RESET_ALLOWLIST_CHECKLIST.some((c) => c.includes("PASSWORD_RESET_REDIRECT_URLS"))).toBe(
      true,
    );
    expect(PASSWORD_RESET_ALLOWLIST_CHECKLIST.some((c) => c.includes("/reset-password"))).toBe(true);
    expect(PASSWORD_RESET_REDIRECT_URLS.some((u) => u.endsWith("/reset-password"))).toBe(true);
  });

  it("documents Google OAuth allowlist steps separately", () => {
    expect(GOOGLE_OAUTH_ALLOWLIST_CHECKLIST.some((c) => c.includes("/auth"))).toBe(true);
    expect(GOOGLE_OAUTH_ALLOWLIST_CHECKLIST.some((c) => /supabase\.co\/auth\/v1\/callback/i.test(c))).toBe(
      true,
    );
  });
});
