/**
 * User-facing auth error copy (Auth Phase 3–4).
 * Prefer clear recovery steps; avoid leaking whether an email exists when possible.
 * Applies to Job Seeker and Recruiter equally; never invents Admin access.
 */
import { ProfileSessionError } from "@/lib/auth";

/**
 * Google provider failures returned on `/auth?error=…`.
 * Keeps copy generic — no hardcoded project refs or secrets.
 */
export function formatGoogleOAuthProviderError(
  error: string | undefined,
  errorDescription: string | undefined,
): string {
  const detail = (errorDescription ?? error ?? "").replace(/\+/g, " ").trim();
  const m = detail.toLowerCase();
  if (m.includes("exchange authorization code") || m.includes("code verifier") || m.includes("pkce")) {
    return "Google could not finish signing in. Try again, or ask an admin to verify Google OAuth redirect URLs and client credentials in Supabase Auth.";
  }
  if (m.includes("access_denied") || m.includes("user cancelled") || m.includes("consent")) {
    return "Google sign-in was cancelled. You can try again whenever you are ready.";
  }
  if (m.includes("redirect") && m.includes("uri")) {
    return "This site's Google redirect URL is not allowlisted yet. Ask an admin to add this origin's /auth URL in Supabase Auth settings.";
  }
  return detail || "Google sign-in didn't work. Please try again.";
}

export function formatAuthErrorMessage(err: unknown): string {
  if (err instanceof ProfileSessionError) return err.message;

  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err && "message" in err
        ? String((err as { message: unknown }).message)
        : "";
  const status =
    typeof err === "object" && err && "status" in err
      ? Number((err as { status: unknown }).status)
      : undefined;
  const m = msg.toLowerCase();

  if (status === 429 || m.includes("rate limit") || m.includes("too many") || m.includes("429")) {
    return "Too many attempts. Wait 30–60 minutes, then try again — or use Continue with Google.";
  }
  if (m.includes("over_email_send_rate_limit") || (m.includes("email") && m.includes("rate limit"))) {
    return "Too many confirmation emails were sent. Wait about an hour, check spam, or use Continue with Google.";
  }
  if (m.includes("invalid login") || m.includes("invalid credentials")) {
    return "That email and password don't match. If you joined with Google, use Continue with Google instead.";
  }
  if (m.includes("already registered") || m.includes("already been registered") || m.includes("user already registered")) {
    return "An account with this email already exists. Switch to Sign in, or use Continue with Google.";
  }
  if (m.includes("email not confirmed")) {
    return "Confirm your email first — open the link we sent, then sign in. Check spam if you don't see it.";
  }
  if (
    m.includes("password") &&
    (m.includes("weak") || m.includes("pwned") || m.includes("least") || m.includes("characters") || m.includes("number"))
  ) {
    return "That password is too weak. Use at least 8 characters with letters and a number.";
  }
  if (m.includes("fetch") || m.includes("network")) {
    return "Can't reach the server. Check your connection and try again.";
  }
  return msg || "Something went wrong. Please try again.";
}
