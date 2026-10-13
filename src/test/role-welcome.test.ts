import { afterEach, describe, expect, it } from "vitest";
import {
  canShowRoleWelcome,
  claimRoleWelcomePresentation,
  clearRoleWelcomeSession,
  firstNameFromFullName,
  markRoleWelcomeShown,
  noteRoleWelcomeEffectCleanup,
  ROLE_WELCOME_STORAGE_KEY,
  shouldShowRoleWelcome,
  welcomeSubtitleForRole,
} from "@/lib/role-welcome";

afterEach(() => {
  sessionStorage.clear();
  clearRoleWelcomeSession();
});

describe("firstNameFromFullName", () => {
  it("uses the first token of the profile name", () => {
    expect(firstNameFromFullName("Priya Das")).toBe("Priya");
  });

  it("trims whitespace and falls back when empty", () => {
    expect(firstNameFromFullName("  Maya  Chen ")).toBe("Maya");
    expect(firstNameFromFullName("   ")).toBe("there");
    expect(firstNameFromFullName("")).toBe("there");
  });
});

describe("welcome role copy and gating", () => {
  it("allows only recruiter and seeker roles", () => {
    expect(canShowRoleWelcome("recruiter")).toBe(true);
    expect(canShowRoleWelcome("seeker")).toBe(true);
    expect(canShowRoleWelcome("admin")).toBe(false);
    expect(canShowRoleWelcome(null)).toBe(false);
    expect(canShowRoleWelcome(undefined)).toBe(false);
  });

  it("returns role-specific subtitles", () => {
    expect(welcomeSubtitleForRole("recruiter")).toMatch(/talent/i);
    expect(welcomeSubtitleForRole("seeker")).toMatch(/role/i);
  });
});

describe("role welcome session gate", () => {
  it("shows once per user until marked, then hides for that user", () => {
    expect(shouldShowRoleWelcome("user-a")).toBe(true);
    markRoleWelcomeShown("user-a");
    expect(sessionStorage.getItem(ROLE_WELCOME_STORAGE_KEY)).toBe("user-a");
    expect(shouldShowRoleWelcome("user-a")).toBe(false);
  });

  it("allows a different user in the same tab session", () => {
    markRoleWelcomeShown("user-a");
    expect(shouldShowRoleWelcome("user-b")).toBe(true);
  });

  it("clears on sign-out so the next login can welcome again", () => {
    markRoleWelcomeShown("user-a");
    sessionStorage.setItem("hirehub.recruiterWelcome.shown", "legacy");
    clearRoleWelcomeSession();
    expect(sessionStorage.getItem(ROLE_WELCOME_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem("hirehub.recruiterWelcome.shown")).toBeNull();
    expect(shouldShowRoleWelcome("user-a")).toBe(true);
  });

  it("allows a Strict Mode remount to reclaim presentation after session mark", () => {
    expect(claimRoleWelcomePresentation("user-strict")).toBe(true);
    expect(shouldShowRoleWelcome("user-strict")).toBe(false);
    expect(claimRoleWelcomePresentation("user-strict")).toBe(false);

    noteRoleWelcomeEffectCleanup("user-strict");
    expect(claimRoleWelcomePresentation("user-strict")).toBe(true);
  });
});
