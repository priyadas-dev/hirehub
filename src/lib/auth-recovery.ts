/**
 * Auth Phase 6 — recovery copy and allowlist checklists.
 * Job Seeker / Recruiter share the same recovery paths; Admin is never offered here.
 */

export type ClaimRecoveryKind = "claim_failed" | "role_not_saved" | "profile_load_failed" | "session_not_ready";

export function recruiterClaimRecoveryMessage(kind: ClaimRecoveryKind, detail?: string): string {
  const base =
    detail?.trim() ||
    (kind === "role_not_saved"
      ? "Your Recruiter role was not saved."
      : kind === "profile_load_failed"
        ? "Your profile role could not be loaded."
        : kind === "session_not_ready"
          ? "Google session was not ready."
          : "Recruiter signup could not be completed.");

  return [
    base,
    "You can continue as a Job Seeker, sign out and retry Sign up → Recruiter → Continue with Google,",
    "or open Settings after signing in to delete the account and sign up again as Recruiter.",
  ].join(" ");
}

/** Ops checklist — Supabase Auth → URL configuration (password recovery). */
export const PASSWORD_RESET_ALLOWLIST_CHECKLIST = [
  "Supabase Auth → URL Configuration → Site URL matches the HireHub origin you use",
  "Additional Redirect URLs include each local origin /reset-password (see PASSWORD_RESET_REDIRECT_URLS)",
  "Additional Redirect URLs include the deployed origin /reset-password",
  "Forgot password uses the same browser origin as the app (window.location.origin)",
  "Open the reset link on that same HireHub host (not a different preview URL)",
] as const;

/** Ops checklist — Google OAuth redirects (pairs with GOOGLE_OAUTH_REDIRECT_URLS). */
export const GOOGLE_OAUTH_ALLOWLIST_CHECKLIST = [
  "Supabase Auth → Providers → Google enabled with Client ID / Secret",
  "Additional Redirect URLs include each local origin /auth",
  "Additional Redirect URLs include the deployed origin /auth",
  "Google Cloud authorized redirect URI includes https://<project>.supabase.co/auth/v1/callback",
] as const;
