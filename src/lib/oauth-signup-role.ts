/**
 * Google OAuth cannot pass `options.data` into `raw_user_meta_data` the way email
 * signup does. The selected signup role is therefore stashed before redirect and
 * claimed once after callback for brand-new Google users only.
 *
 * Authorization still comes only from `profiles.role` (never from this intent).
 */
import type { SignupRole } from "@/lib/auth-intent";
import { parseAuthIntent, signupRoleToIntent, type AuthIntent } from "@/lib/auth-intent";

export const OAUTH_SIGNUP_ROLE_STORAGE_KEY = "hirehub.oauthSignupRole" as const;

/** New Google accounts may claim a public signup role only within this window. */
export const OAUTH_SIGNUP_ROLE_CLAIM_WINDOW_MS = 15 * 60 * 1000;

export function parseSignupRole(value: unknown): SignupRole | undefined {
  if (value === "job_seeker" || value === "recruiter") return value;
  return undefined;
}

/**
 * Build the `/auth` redirect URL for Google OAuth so the chosen signup role
 * survives the provider round-trip (query params are preserved by Supabase).
 */
export function buildGoogleOAuthRedirectTo(input: {
  origin: string;
  mode: "signin" | "signup";
  role: SignupRole;
  redirect?: string;
  intent?: AuthIntent;
}): string {
  const url = new URL("/auth", input.origin);
  if (input.redirect) url.searchParams.set("redirect", input.redirect);
  if (input.mode === "signup") {
    url.searchParams.set("mode", "signup");
    url.searchParams.set("intent", signupRoleToIntent(input.role));
  } else if (input.intent) {
    // Marketing deep-link only — never used to overwrite an existing profile role.
    url.searchParams.set("intent", input.intent);
  }
  return url.toString();
}

export function stashOAuthSignupRole(role: SignupRole): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(OAUTH_SIGNUP_ROLE_STORAGE_KEY, role);
  } catch {
    // Private mode / blocked storage — redirectTo intent is the fallback.
  }
}

export function peekOAuthSignupRole(): SignupRole | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  try {
    return parseSignupRole(sessionStorage.getItem(OAUTH_SIGNUP_ROLE_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

export function clearOAuthSignupRole(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(OAUTH_SIGNUP_ROLE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Consume stashed role (clears storage). */
export function takeOAuthSignupRole(): SignupRole | undefined {
  const role = peekOAuthSignupRole();
  clearOAuthSignupRole();
  return role;
}

/**
 * Resolve the role the user selected for this Google signup attempt.
 * Prefers sessionStorage (set immediately before redirect); falls back to
 * `?intent=` on the OAuth return URL when storage was unavailable.
 */
export function resolvePendingOAuthSignupRole(input: {
  stashedRole?: SignupRole | null;
  intent?: unknown;
  mode?: "signin" | "signup" | undefined;
}): SignupRole | undefined {
  const stashed = parseSignupRole(input.stashedRole ?? undefined);
  if (stashed) return stashed;
  // Only treat URL intent as a signup choice when returning to signup mode.
  if (input.mode !== "signup") return undefined;
  const intent = parseAuthIntent(input.intent);
  if (!intent) return undefined;
  return intent === "recruiter" ? "recruiter" : "job_seeker";
}

export function isWithinOAuthSignupClaimWindow(
  createdAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!createdAt) return false;
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return false;
  return nowMs - createdMs <= OAUTH_SIGNUP_ROLE_CLAIM_WINDOW_MS && nowMs - createdMs >= 0;
}

/**
 * Decide whether a Google OAuth callback may set `profiles.role` from the UI choice.
 * Never touches recruiter/admin. Never invents admin.
 *
 * Allows job_seeker → recruiter when:
 * - brand-new Google account (claim window), or
 * - unused Google seeker (no applications / companies) who explicitly chose Recruiter
 *   on the signup screen (covers accounts stuck as seeker from earlier Google signups).
 */
export function shouldApplyOAuthSignupRole(input: {
  requestedRole: SignupRole;
  currentRole: string | null | undefined;
  userCreatedAt: string | null | undefined;
  hasGoogleIdentity: boolean;
  unusedSeekerAccount?: boolean;
  nowMs?: number;
}): boolean {
  if (!input.hasGoogleIdentity) return false;
  if (input.requestedRole !== "recruiter") return false;
  if (input.currentRole !== "job_seeker") return false;
  if (isWithinOAuthSignupClaimWindow(input.userCreatedAt, input.nowMs)) return true;
  return input.unusedSeekerAccount === true;
}
