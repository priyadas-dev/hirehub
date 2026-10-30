/**
 * Google OAuth cannot pass `options.data` into `raw_user_meta_data` the way email
 * signup does. Sign up therefore stashes the selected role and repeats it on the
 * callback URL. The claim runs once, for brand-new Google users only.
 *
 * Sign in does not carry a role. Existing `profiles.role` is never overwritten
 * from the sign-in screen, and public registration cannot grant `admin`.
 *
 * Authorization still comes only from `profiles.role` (never from this intent).
 */
import type { SignupRole } from "@/lib/auth-intent";
import { parseAuthIntent, signupRoleToIntent } from "@/lib/auth-intent";

export const OAUTH_SIGNUP_ROLE_STORAGE_KEY = "hirehub.oauthSignupRole" as const;

/** Query flag set only on the Sign up → Google redirect. Marketing links must not set this. */
export const GOOGLE_OAUTH_CALLBACK_QUERY = "oauth" as const;
export const GOOGLE_OAUTH_CALLBACK_VALUE = "google" as const;
/** Sign-in Google callback. Carries no role. Distinguishes this return from a normal /auth visit. */
export const GOOGLE_OAUTH_SIGNIN_VALUE = "signin" as const;

export const OAUTH_SIGNIN_ATTEMPT_KEY = "hirehub.oauthSignInAttempt" as const;
export const OAUTH_SIGNIN_HANDLED_KEY = "hirehub.oauthSignInHandled" as const;

/**
 * A Google user created by this sign-in callback is only seconds old when we
 * inspect them. Keep the window long enough for a slow page, and short enough
 * that an account created earlier is left alone.
 */
export const UNREGISTERED_GOOGLE_SIGNIN_WINDOW_MS = 2 * 60 * 1000;

/** New Google accounts may claim a public signup role only within this window. */
export const OAUTH_SIGNUP_ROLE_CLAIM_WINDOW_MS = 15 * 60 * 1000;

/** How long we wait for Supabase to start the Google redirect before resetting the button. */
export const GOOGLE_OAUTH_START_TIMEOUT_MS = 15_000;

/** How long we wait for the post-OAuth recruiter role claim before falling back. */
export const OAUTH_SIGNUP_ROLE_CLAIM_TIMEOUT_MS = 12_000;

/**
 * Reject if `promise` does not settle within `ms`.
 * Does not cancel the underlying work; callers must still ignore late results when unmounted.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function parseSignupRole(value: unknown): SignupRole | undefined {
  if (value === "job_seeker" || value === "recruiter") return value;
  return undefined;
}

/**
 * Build the `/auth` redirect URL for Google OAuth.
 *
 * Sign up embeds `mode`, `intent`, and `oauth=google` so the chosen role survives
 * the provider round-trip even when sessionStorage is blocked.
 * Sign in embeds `oauth=signin` and no role. That flag marks this callback so a
 * brand-new Google user can be rejected. It is not a role and cannot grant one.
 */
export function buildGoogleOAuthRedirectTo(input: {
  origin: string;
  mode: "signin" | "signup";
  role?: SignupRole;
  redirect?: string;
}): string {
  const url = new URL("/auth", input.origin);
  if (input.redirect) url.searchParams.set("redirect", input.redirect);
  if (input.mode !== "signup") {
    url.searchParams.set(GOOGLE_OAUTH_CALLBACK_QUERY, GOOGLE_OAUTH_SIGNIN_VALUE);
    return url.toString();
  }
  const role = parseSignupRole(input.role) ?? "job_seeker";
  url.searchParams.set("mode", "signup");
  url.searchParams.set("intent", signupRoleToIntent(role));
  url.searchParams.set(GOOGLE_OAUTH_CALLBACK_QUERY, GOOGLE_OAUTH_CALLBACK_VALUE);
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
 * Resolve the role selected for a Google signup attempt.
 * Explicit sign-in returns nothing — stash and URL intent are ignored — so
 * signing in cannot change `profiles.role`.
 *
 * Otherwise prefers sessionStorage, then `?intent=` when storage was unavailable.
 * Applying the role still goes through `shouldApplyOAuthSignupRole`
 * (brand-new Google users only; never admin).
 */
export function resolvePendingOAuthSignupRole(input: {
  stashedRole?: SignupRole | null;
  intent?: unknown;
  mode?: "signin" | "signup" | undefined;
}): SignupRole | undefined {
  if (input.mode === "signin") return undefined;
  const stashed = parseSignupRole(input.stashedRole ?? undefined);
  if (stashed) return stashed;
  const intent = parseAuthIntent(input.intent);
  if (!intent) return undefined;
  return intent === "recruiter" ? "recruiter" : "job_seeker";
}

/** True only for the URL we build in Sign up → Continue with Google. */
export function isGoogleSignupCallback(input: {
  searchMode?: string | null;
  oauth?: unknown;
}): boolean {
  return input.searchMode === "signup" && input.oauth === GOOGLE_OAUTH_CALLBACK_VALUE;
}

/**
 * Role to apply after landing back on `/auth`.
 *
 * A sessionStorage stash counts even when the provider drops query params
 * (that is how Recruiter survives a stripped callback). The URL intent counts
 * only on a real Google signup callback, never on a marketing `?intent=` link
 * and never on Sign in.
 */
export function resolveOAuthReturnRole(input: {
  stashedRole?: SignupRole | null;
  intent?: unknown;
  searchMode?: "signup" | null;
  oauth?: unknown;
}): SignupRole | undefined {
  const stashed = parseSignupRole(input.stashedRole ?? undefined);
  if (stashed) {
    return resolvePendingOAuthSignupRole({
      stashedRole: stashed,
      intent: input.intent,
      mode: "signup",
    });
  }
  if (!isGoogleSignupCallback({ searchMode: input.searchMode, oauth: input.oauth })) {
    return undefined;
  }
  return resolvePendingOAuthSignupRole({
    stashedRole: undefined,
    intent: input.intent,
    mode: "signup",
  });
}

export function markOAuthSignInAttempt(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(OAUTH_SIGNIN_HANDLED_KEY);
    sessionStorage.setItem(OAUTH_SIGNIN_ATTEMPT_KEY, "1");
  } catch {
    // redirectTo ?oauth=signin is the fallback
  }
}

export function peekOAuthSignInAttempt(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(OAUTH_SIGNIN_ATTEMPT_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearOAuthSignInAttempt(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(OAUTH_SIGNIN_ATTEMPT_KEY);
  } catch {
    // ignore
  }
}

export function markOAuthSignInHandled(userId: string): void {
  if (typeof sessionStorage === "undefined" || !userId) return;
  try {
    sessionStorage.setItem(OAUTH_SIGNIN_HANDLED_KEY, userId);
  } catch {
    // ignore
  }
}

export function peekOAuthSignInHandled(): string | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  try {
    const value = sessionStorage.getItem(OAUTH_SIGNIN_HANDLED_KEY);
    return value && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function clearOAuthSignInHandled(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(OAUTH_SIGNIN_HANDLED_KEY);
  } catch {
    // ignore
  }
}

export function oauthIdentityFlags(user: {
  identities?: { provider: string }[] | null;
  app_metadata?: { provider?: string; providers?: string[] } | null;
}): { hasGoogleIdentity: boolean; hasEmailIdentity: boolean } {
  const providers = new Set<string>();
  for (const identity of user.identities ?? []) {
    if (identity.provider) providers.add(identity.provider);
  }
  if (user.app_metadata?.provider) providers.add(user.app_metadata.provider);
  for (const provider of user.app_metadata?.providers ?? []) {
    if (provider) providers.add(provider);
  }
  return {
    hasGoogleIdentity: providers.has("google"),
    hasEmailIdentity: providers.has("email"),
  };
}

/**
 * True only for a Google account Supabase just created because Sign in was used
 * by someone HireHub had never seen.
 *
 * Existing accounts are older than the window, already handled, or not a
 * sign-in callback. Email-linked, recruiter, and admin accounts are never
 * selected. A Sign up callback (`hasSignupRole`) is never selected.
 */
export function shouldDiscardUnregisteredGoogleSignIn(input: {
  oauth?: unknown;
  signInAttempt?: boolean;
  hasSignupRole?: boolean;
  handledUserId?: string | null;
  userId?: string | null;
  createdAt?: string | null;
  hasGoogleIdentity: boolean;
  hasEmailIdentity: boolean;
  currentRole?: string | null;
  nowMs?: number;
}): boolean {
  if (input.hasSignupRole) return false;
  const signInReturn = input.oauth === GOOGLE_OAUTH_SIGNIN_VALUE || input.signInAttempt === true;
  if (!signInReturn) return false;
  if (input.handledUserId && input.userId && input.handledUserId === input.userId) return false;
  if (!input.hasGoogleIdentity || input.hasEmailIdentity) return false;
  if (input.currentRole && input.currentRole !== "job_seeker") return false;
  if (!input.createdAt) return false;
  const createdMs = Date.parse(input.createdAt);
  if (!Number.isFinite(createdMs)) return false;
  const nowMs = input.nowMs ?? Date.now();
  const age = nowMs - createdMs;
  return age <= UNREGISTERED_GOOGLE_SIGNIN_WINDOW_MS && age >= -30_000;
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
 *
 * Only brand-new Google accounts (within the claim window) that still have the
 * trigger default `job_seeker` may become `recruiter`. Existing seekers are never
 * promoted. Recruiter/admin are never overwritten. `admin` is never grantable here.
 */
export function shouldApplyOAuthSignupRole(input: {
  requestedRole: SignupRole;
  currentRole: string | null | undefined;
  userCreatedAt: string | null | undefined;
  hasGoogleIdentity: boolean;
  nowMs?: number;
}): boolean {
  if (!input.hasGoogleIdentity) return false;
  if (input.requestedRole !== "recruiter") return false;
  if (input.currentRole !== "job_seeker") return false;
  return isWithinOAuthSignupClaimWindow(input.userCreatedAt, input.nowMs);
}

/** Human-readable skip reason when a recruiter claim is intentionally not applied. */
export function oauthSignupRoleSkipReason(input: {
  requestedRole: SignupRole;
  currentRole: string | null | undefined;
  userCreatedAt: string | null | undefined;
  hasGoogleIdentity: boolean;
  nowMs?: number;
}): string | undefined {
  if (input.requestedRole !== "recruiter") return undefined;
  if (!input.hasGoogleIdentity) {
    return "Recruiter Google signup requires a Google identity.";
  }
  if (input.currentRole === "recruiter" || input.currentRole === "admin") {
    return undefined; // already correct / privileged — silent keep
  }
  if (input.currentRole !== "job_seeker") return undefined;
  if (!isWithinOAuthSignupClaimWindow(input.userCreatedAt, input.nowMs)) {
    return "This Google account already exists as a Job Seeker. HireHub will not change an existing role. Use a new Google account to sign up as a Recruiter.";
  }
  return undefined;
}

/**
 * Whether server env looks configured for the admin claim path.
 * Checks presence only — never returns or logs secret values.
 */
export function isSupabaseServiceRoleConfigured(env: {
  SUPABASE_URL?: string | undefined;
  SUPABASE_SERVICE_ROLE_KEY?: string | undefined;
} = typeof process !== "undefined" ? process.env : {}): boolean {
  return Boolean(env.SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

/** Loading-flag cleanup contract for Google OAuth UI states. */
export function resetGoogleOAuthLoadingFlags(): {
  busy: null;
  oauthClaiming: false;
} {
  return { busy: null, oauthClaiming: false };
}

export type PostGoogleAuthStep = "claim_recruiter" | "go_home";

/** Plan post-callback work from the pending signup role (never trusts admin). */
export function planPostGoogleAuth(pending: SignupRole | undefined): PostGoogleAuthStep {
  return pending === "recruiter" ? "claim_recruiter" : "go_home";
}
