/**
 * Pure helpers for Google OAuth recruiter claim (Auth Phase 2).
 * Never delete+insert profiles — UPDATE only (or SQL RPC that UPDATEs).
 */
import type { SignupRole } from "@/lib/auth-intent";
import {
  oauthSignupRoleSkipReason,
  shouldApplyOAuthSignupRole,
} from "@/lib/oauth-signup-role";

export const CLAIM_OAUTH_RECRUITER_ROLE_RPC = "claim_oauth_recruiter_role" as const;

export type DbPublicRole = "job_seeker" | "recruiter" | "admin";

export type ClaimOAuthSignupRoleResult =
  | { ok: true; applied: boolean; role: DbPublicRole; reason?: string }
  | { ok: false; message: string; retryable?: boolean };

/** RPC status strings from public.claim_oauth_recruiter_role. */
export type ClaimOAuthRpcStatus =
  | "applied"
  | "already_recruiter"
  | "outside_claim_window"
  | "no_google_identity"
  | "profile_missing"
  | "user_missing"
  | "role_not_eligible"
  | "update_failed"
  | "invalid_user";

export function userHasGoogleIdentity(user: {
  identities?: { provider: string }[] | null;
  app_metadata?: { provider?: string; providers?: string[] } | null;
}): boolean {
  return (
    (user.identities ?? []).some((i) => i.provider === "google") ||
    user.app_metadata?.provider === "google" ||
    (Array.isArray(user.app_metadata?.providers) &&
      user.app_metadata.providers.includes("google"))
  );
}

export function isValidDbPublicRole(role: string | null | undefined): role is DbPublicRole {
  return role === "job_seeker" || role === "recruiter" || role === "admin";
}

/** True when a failed claim may succeed on one immediate retry (transient / race). */
export function isRetryableClaimFailure(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  if (m.includes("only admins can change roles")) return true;
  if (m.includes("profile is not ready")) return true;
  if (m.includes("could not verify your google")) return true;
  if (m.includes("timed out")) return true;
  if (m.includes("update_failed")) return true;
  if (m.includes("role update did not stick")) return true;
  if (m.includes("network") || m.includes("fetch")) return true;
  return false;
}

export function mapClaimRpcStatus(
  status: string,
  currentRole: DbPublicRole,
): ClaimOAuthSignupRoleResult {
  switch (status) {
    case "applied":
      return { ok: true, applied: true, role: "recruiter" };
    case "already_recruiter":
      return { ok: true, applied: false, role: "recruiter" };
    case "outside_claim_window":
      return {
        ok: true,
        applied: false,
        role: currentRole,
        reason:
          "This Google account already exists as a Job Seeker. HireHub will not change an existing role. Use a new Google account to sign up as a Recruiter.",
      };
    case "no_google_identity":
      return {
        ok: true,
        applied: false,
        role: currentRole,
        reason: "Recruiter Google signup requires a Google identity.",
      };
    case "profile_missing":
      return { ok: false, message: "Your profile is not ready yet. Try signing in again.", retryable: true };
    case "user_missing":
      return { ok: false, message: "Could not verify your Google account.", retryable: true };
    case "role_not_eligible":
      return { ok: true, applied: false, role: currentRole };
    case "update_failed":
      return {
        ok: false,
        message: "Recruiter role update did not stick. Please try Continue with Google again.",
        retryable: true,
      };
    case "invalid_user":
      return { ok: false, message: "Could not verify your Google account." };
    default:
      return { ok: false, message: `Unexpected claim status: ${status}`, retryable: false };
  }
}

export function isMissingRpcError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("claim_oauth_recruiter_role") ||
    m.includes("could not find the function") ||
    m.includes("schema cache") ||
    /\b42883\b/.test(message) ||
    m.includes("pgrst202")
  );
}

export function buildSkipClaimResult(input: {
  requestedRole: SignupRole;
  currentRole: DbPublicRole;
  userCreatedAt: string | null | undefined;
  hasGoogleIdentity: boolean;
  nowMs?: number;
}): ClaimOAuthSignupRoleResult {
  return {
    ok: true,
    applied: false,
    role: input.currentRole,
    reason: oauthSignupRoleSkipReason(input),
  };
}

export function evaluateClaimEligibility(input: {
  requestedRole: SignupRole;
  currentRole: DbPublicRole;
  userCreatedAt: string | null | undefined;
  hasGoogleIdentity: boolean;
  nowMs?: number;
}): { apply: boolean; skip: ClaimOAuthSignupRoleResult | null } {
  if (
    !shouldApplyOAuthSignupRole({
      requestedRole: input.requestedRole,
      currentRole: input.currentRole,
      userCreatedAt: input.userCreatedAt,
      hasGoogleIdentity: input.hasGoogleIdentity,
      nowMs: input.nowMs,
    })
  ) {
    return { apply: false, skip: buildSkipClaimResult(input) };
  }
  return { apply: true, skip: null };
}

/**
 * Run an async claim attempt; on retryable failure, wait briefly and try once more.
 * Does not delete profile rows.
 */
export async function withOneClaimRetry<T extends ClaimOAuthSignupRoleResult>(
  attempt: () => Promise<T>,
  pauseMs: number = 400,
): Promise<T> {
  const first = await attempt();
  if (first.ok) return first;
  if (!first.retryable && !isRetryableClaimFailure(first.message)) return first;
  await new Promise((r) => setTimeout(r, pauseMs));
  return attempt();
}

/** Email signup metadata — trigger `handle_new_user` reads `requested_role`. */
export function buildEmailSignupMetadata(input: {
  fullName: string;
  requestedRole: SignupRole;
}): { full_name: string; requested_role: SignupRole } {
  return {
    full_name: input.fullName,
    requested_role: input.requestedRole,
  };
}
