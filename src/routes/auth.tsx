import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Briefcase, Loader2, MailCheck, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/Logo";
import { StatusTracker } from "@/components/status/StatusTracker";
import {
  ProfileSessionError,
  ROLE_HOME,
  readSession,
  resolvePostAuthPath,
  useAuth,
  workspaceWelcomeDescription,
  type Role,
} from "@/lib/auth";
import { formatAuthErrorMessage, formatGoogleOAuthProviderError } from "@/lib/auth-errors";
import {
  recruiterClaimRecoveryMessage,
  type ClaimRecoveryKind,
} from "@/lib/auth-recovery";
import {
  AUTH_INTENT_LABEL,
  intentToSignupRole,
  parseAuthIntent,
  type AuthIntent,
  type SignupRole,
} from "@/lib/auth-intent";
import {
  authSignInFormSchema,
  authSignupFormSchema,
  signUpWithAccountEmail,
} from "@/lib/account-password";
import { claimOAuthSignupRole } from "@/lib/claim-oauth-signup-role";
import { discardUnregisteredGoogleSignIn } from "@/lib/discard-unregistered-google-signin";
import {
  buildGoogleOAuthRedirectTo,
  clearOAuthSignInAttempt,
  clearOAuthSignupRole,
  GOOGLE_OAUTH_CALLBACK_VALUE,
  GOOGLE_OAUTH_SIGNIN_VALUE,
  GOOGLE_OAUTH_START_TIMEOUT_MS,
  markOAuthSignInAttempt,
  markOAuthSignInHandled,
  oauthIdentityFlags,
  OAUTH_SIGNUP_ROLE_CLAIM_TIMEOUT_MS,
  parseSignupRole,
  peekOAuthSignInAttempt,
  peekOAuthSignInHandled,
  peekOAuthSignupRole,
  planPostGoogleAuth,
  resolveOAuthReturnRole,
  shouldDiscardUnregisteredGoogleSignIn,
  stashOAuthSignupRole,
  withTimeout,
} from "@/lib/oauth-signup-role";
import { sendAccountMail } from "@/lib/send-account-mail";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): {
    redirect?: string;
    mode?: "signup";
    intent?: AuthIntent;
    oauth?: "google" | "signin";
    error?: string;
    error_description?: string;
  } => {
    const intent = parseAuthIntent(s["intent"]);
    return {
      ...(typeof s["redirect"] === "string" ? { redirect: s["redirect"] } : {}),
      ...(s["mode"] === "signup" ? { mode: "signup" as const } : {}),
      ...(intent ? { intent } : {}),
      ...(s["oauth"] === GOOGLE_OAUTH_CALLBACK_VALUE
        ? { oauth: "google" as const }
        : s["oauth"] === GOOGLE_OAUTH_SIGNIN_VALUE
          ? { oauth: "signin" as const }
          : {}),
      ...(typeof s["error"] === "string" ? { error: s["error"] } : {}),
      ...(typeof s["error_description"] === "string" ? { error_description: s["error_description"] } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "Sign in — HireHub" },
      { name: "description", content: "Sign in or create your HireHub account." },
      { property: "og:title", content: "Sign in — HireHub" },
      { property: "og:description", content: "Sign in or create your HireHub account." },
    ],
  }),
  /**
   * Established sessions skip the auth form (Phase 5).
   * Google callbacks (`oauth`) and provider `error` must still render `/auth`
   * so claim / discard / error toasts can run.
   */
  beforeLoad: async ({ search }) => {
    if (search.error || search.oauth) return;
    try {
      const session = await readSession();
      if (!session) return;
      throw redirect({
        to: resolvePostAuthPath(session.role, search.redirect),
        replace: true,
      });
    } catch (err) {
      if (err instanceof ProfileSessionError) return;
      throw err;
    }
  },
  component: AuthPage,
});

const ROLES: { id: SignupRole; label: string; desc: string; icon: typeof Search }[] = [
  { id: "job_seeker", label: "Job Seeker", desc: "Find and apply to roles", icon: Search },
  { id: "recruiter", label: "Recruiter", desc: "Post jobs, hire talent", icon: Briefcase },
];

function AuthPage() {
  const search = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">(search.mode === "signup" ? "signup" : "signin");
  const [role, setRole] = useState<SignupRole>(() =>
    search.intent ? intentToSignupRole(search.intent) : "job_seeker",
  );
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [busy, setBusy] = useState<"form" | "google" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [oauthClaiming, setOauthClaiming] = useState(false);
  const [claimRecovery, setClaimRecovery] = useState<{
    kind: ClaimRecoveryKind;
    detail?: string;
  } | null>(null);
  /** Set only after goHome — must not block Strict Mode remount retries. */
  const redirectedRef = useRef(false);
  /** Email/password auth owns the redirect. Do not also run the Google role claim. */
  const emailFlowRef = useRef(false);
  /** After a failed recruiter claim, stay on /auth until the user picks a recovery action. */
  const suppressHomeRef = useRef(false);
  const googleBusySafetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mailAccount = useServerFn(sendAccountMail);
  const claimGoogleSignupRole = useServerFn(claimOAuthSignupRole);
  const discardGoogleSignIn = useServerFn(discardUnregisteredGoogleSignIn);
  const { user, loading, profileError, refresh, signOut } = useAuth();
  const navigate = useNavigate();

  function presentClaimRecovery(kind: ClaimRecoveryKind, detail?: string) {
    suppressHomeRef.current = true;
    clearOAuthSignupRole();
    clearOAuthSignInAttempt();
    setMode("signup");
    setRole("recruiter");
    setClaimRecovery({ kind, detail });
    toast.error("Could not finish recruiter signup", {
      description: recruiterClaimRecoveryMessage(kind, detail),
    });
    navigate({
      to: "/auth",
      search: {
        mode: "signup",
        intent: "recruiter",
        ...(search.redirect ? { redirect: search.redirect } : {}),
      },
      replace: true,
    });
  }

  function dismissClaimRecovery() {
    suppressHomeRef.current = false;
    setClaimRecovery(null);
  }

  function clearGoogleBusySafetyTimer() {
    if (googleBusySafetyTimer.current) {
      clearTimeout(googleBusySafetyTimer.current);
      googleBusySafetyTimer.current = null;
    }
  }

  function resetAuthLoadingFlags() {
    setBusy(null);
    setOauthClaiming(false);
    clearGoogleBusySafetyTimer();
  }

  useEffect(() => {
    return () => {
      clearGoogleBusySafetyTimer();
    };
  }, []);

  useEffect(() => {
    if (search.intent) setRole(intentToSignupRole(search.intent));
  }, [search.intent]);

  function goHome(r: Role) {
    const dest = resolvePostAuthPath(r, search.redirect);
    if (dest === ROLE_HOME[r] || dest === "/settings") {
      navigate({ to: dest, replace: true });
      return;
    }
    window.location.assign(dest);
  }

  // Surface OAuth provider failures returned by Supabase on redirect.
  // Clear role/sign-in stashes so a cancelled or failed Google attempt cannot
  // leak into the next email signup or Google retry.
  useEffect(() => {
    if (!search.error) return;
    resetAuthLoadingFlags();
    clearOAuthSignupRole();
    clearOAuthSignInAttempt();
    toast.error("Google sign-in didn't work", {
      description: formatGoogleOAuthProviderError(search.error, search.error_description),
    });
    navigate({
      to: "/auth",
      search: {
        ...(search.redirect ? { redirect: search.redirect } : {}),
        ...(search.mode ? { mode: search.mode } : {}),
        ...(search.mode === "signup" && search.intent ? { intent: search.intent } : {}),
      },
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.error, search.error_description]);

  // Already signed in (including after returning from Google) → claim OAuth signup
  // role if needed, then go to the verified profiles.role workspace.
  // Wait until auth finished loading so we never redirect with a stale/wrong role.
  useEffect(() => {
    if (loading || !user || redirectedRef.current) return;
    if (suppressHomeRef.current) return;

    if (emailFlowRef.current) return;

    let cancelled = false;
    // Peek (don't take) so React Strict Mode remounts still see the stashed role.
    // Sign-in returns have no stash and no oauth=google flag, so pending stays empty
    // and the saved profiles.role is used as-is.
    const pending = resolveOAuthReturnRole({
      stashedRole: peekOAuthSignupRole(),
      intent: search.intent,
      searchMode: search.mode,
      oauth: search.oauth,
    });
    const step = planPostGoogleAuth(pending);

    void (async () => {
      let homeRole: Role = user.role;
      let blockHome = false;

      if (step === "claim_recruiter") {
        setOauthClaiming(true);
        try {
          // Ensure the bearer token is available for the claim server fn.
          const sessionWait = await withTimeout(
            (async () => {
              for (let i = 0; i < 20; i++) {
                const { data } = await supabase.auth.getSession();
                if (data.session?.access_token) return data.session.access_token;
                await new Promise((r) => setTimeout(r, 100));
              }
              return null;
            })(),
            OAUTH_SIGNUP_ROLE_CLAIM_TIMEOUT_MS,
            "Waiting for Google session timed out.",
          );
          if (cancelled) return;
          if (!sessionWait) {
            throw new Error("Google session was not ready. Please try Continue with Google again.");
          }

          // Server handler already retries once; keep a single client call with timeout.
          const claimed = await withTimeout(
            claimGoogleSignupRole({ data: { requestedRole: "recruiter" } }),
            OAUTH_SIGNUP_ROLE_CLAIM_TIMEOUT_MS,
            "Applying your recruiter role timed out. Your workspace was not opened. Try Continue with Google again.",
          );
          if (cancelled) return;
          if (!claimed.ok) {
            blockHome = true;
            presentClaimRecovery("claim_failed", claimed.message);
          } else if (!claimed.applied && claimed.reason) {
            // Existing seeker (or ineligible) tried Recruiter Google signup — keep saved role.
            toast.message("Signed in with your existing role", { description: claimed.reason });
          }

          if (!blockHome) {
            const s = await withTimeout(
              refresh(),
              OAUTH_SIGNUP_ROLE_CLAIM_TIMEOUT_MS,
              "Loading your profile timed out after Google sign-in.",
            );
            if (cancelled) return;
            if (!s) {
              blockHome = true;
              presentClaimRecovery("profile_load_failed");
            } else if (claimed.ok && claimed.applied && s.role !== "recruiter") {
              blockHome = true;
              presentClaimRecovery("role_not_saved");
            } else {
              homeRole = s.role;
              if (claimed.ok && claimed.applied) {
                toast.success("Welcome to HireHub", {
                  description: workspaceWelcomeDescription(s.role),
                });
              }
            }
          }
        } catch (err) {
          if (!cancelled) {
            blockHome = true;
            const detail = formatAuthErrorMessage(err);
            const kind: ClaimRecoveryKind =
              detail.toLowerCase().includes("session") ? "session_not_ready" : "claim_failed";
            presentClaimRecovery(kind, detail);
          }
        } finally {
          setOauthClaiming(false);
        }
      }

      if (!cancelled && !redirectedRef.current && !blockHome && step !== "claim_recruiter") {
        const signInReturn = search.oauth === "signin" || peekOAuthSignInAttempt();
        const alreadyHandled = peekOAuthSignInHandled() === user.id;
        if (signInReturn && !pending && !alreadyHandled) {
          setOauthClaiming(true);
          try {
            const { data: authData } = await supabase.auth.getUser();
            const authUser = authData.user;
            const flags = oauthIdentityFlags(authUser ?? {});
            const dbRole = homeRole === "seeker" ? "job_seeker" : homeRole;
            const unregistered = shouldDiscardUnregisteredGoogleSignIn({
              oauth: search.oauth,
              signInAttempt: peekOAuthSignInAttempt(),
              hasSignupRole: false,
              handledUserId: peekOAuthSignInHandled(),
              userId: user.id,
              createdAt: authUser?.created_at,
              hasGoogleIdentity: flags.hasGoogleIdentity,
              hasEmailIdentity: flags.hasEmailIdentity,
              currentRole: dbRole,
            });
            if (cancelled) return;
            if (!authUser) {
              blockHome = true;
              toast.error("Could not verify this Google account. Try Continue with Google again.");
            } else if (unregistered) {
              const removed = await withTimeout(
                discardGoogleSignIn({ data: { confirmSignIn: true } }),
                OAUTH_SIGNUP_ROLE_CLAIM_TIMEOUT_MS,
                "Checking this Google account timed out.",
              );
              if (cancelled) return;
              if (removed.ok && !removed.discarded) {
                markOAuthSignInHandled(user.id);
                clearOAuthSignInAttempt();
              } else {
                const description = removed.ok
                  ? "This Google account is not registered. Choose Job Seeker or Recruiter, then create the account."
                  : removed.message;
                setMode("signup");
                setNotice(description);
                if (removed.ok) {
                  toast.message("No HireHub account for this Google user", { description });
                } else {
                  toast.error("Could not finish Google sign-in", { description });
                }
                clearOAuthSignInAttempt();
                clearOAuthSignupRole();
                blockHome = true;
                await signOut();
              }
            } else {
              markOAuthSignInHandled(user.id);
              clearOAuthSignInAttempt();
            }
          } catch (err) {
            if (!cancelled) {
              blockHome = true;
              clearOAuthSignInAttempt();
              await signOut();
              const description = formatAuthErrorMessage(err);
              setMode("signup");
              setNotice(description);
              toast.error("Could not finish Google sign-in", { description });
            }
          } finally {
            setOauthClaiming(false);
          }
        }
      }

      if (cancelled || redirectedRef.current || blockHome) {
        if (blockHome && !cancelled) resetAuthLoadingFlags();
        return;
      }
      redirectedRef.current = true;
      const googleSignupReturn = search.oauth === "google";
      const googleSignInReturn = search.oauth === "signin" || peekOAuthSignInAttempt();
      clearOAuthSignupRole();
      clearOAuthSignInAttempt();
      if (googleSignInReturn) {
        markOAuthSignInHandled(user.id);
      }
      // Seeker Google signup uses go_home (no claim). Recruiter welcome is toasted after claim.
      // Admin never signs up here; Sign in still opens ROLE_HOME including admin.
      if (googleSignupReturn && step === "go_home") {
        toast.success("Welcome to HireHub", {
          description: workspaceWelcomeDescription(homeRole),
        });
      } else if (googleSignInReturn && step === "go_home") {
        toast.success("Welcome back", {
          description: workspaceWelcomeDescription(homeRole),
        });
      }
      resetAuthLoadingFlags();
      goHome(homeRole);
    })();

    return () => {
      cancelled = true;
      // Always unlock the UI on cleanup (Strict Mode remount / navigate away).
      setOauthClaiming(false);
      setBusy(null);
      clearGoogleBusySafetyTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading]);

  useEffect(() => {
    if (loading || !profileError) return;
    toast.error("Could not open your workspace", { description: profileError });
  }, [loading, profileError]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || oauthClaiming) return;
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    const password = String(fd.get("password") ?? "");
    if (mode === "signup") {
      const parsed = authSignupFormSchema.safeParse({
        name: fd.get("name"),
        email,
        password,
      });
      if (!parsed.success) {
        setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
        return;
      }
      const signupRole = parseSignupRole(role);
      if (!signupRole) {
        toast.error("Choose Job Seeker or Recruiter before creating an account.");
        return;
      }
      setErrors({});
      setNotice(null);
      setBusy("form");
      emailFlowRef.current = true;
      clearOAuthSignupRole();
      try {
        const { data, error } = await signUpWithAccountEmail({
          email: parsed.data.email,
          password: parsed.data.password,
          fullName: parsed.data.name,
          requestedRole: signupRole,
          origin: window.location.origin,
        });
        if (error) throw error;
        if (data.user && data.user.identities?.length === 0) {
          throw new Error("User already registered");
        }
        if (!data.session) {
          const mailed = await mailAccount({
            data: { to: parsed.data.email, kind: "signup", origin: window.location.origin },
          });
          setNotice(
            mailed.ok
              ? `We sent a confirmation email to ${parsed.data.email}. Open the link to activate your account, then sign in. Check spam if it is missing.`
              : `Your account was created. ${mailed.message} You can also use Continue with Google.`,
          );
          toast.success(mailed.ok ? "Check your email to confirm your account" : "Account created");
          emailFlowRef.current = false;
          setMode("signin");
          return;
        }
        const s = await refresh();
        if (!s) {
          throw new ProfileSessionError(
            "profile_missing",
            "Could not load your profile role from the database. HireHub will not open a workspace without a valid profiles.role.",
          );
        }
        toast.success("Welcome to HireHub", {
          description: workspaceWelcomeDescription(s.role),
        });
        goHome(s.role);
      } catch (err) {
        emailFlowRef.current = false;
        toast.error(formatAuthErrorMessage(err));
      } finally {
        setBusy(null);
      }
      return;
    }

    const parsed = authSignInFormSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setNotice(null);
    setBusy("form");
    emailFlowRef.current = true;
    clearOAuthSignupRole();
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      if (error) throw error;
      const s = await refresh();
      if (!s) {
        throw new ProfileSessionError(
          "profile_missing",
          "Could not load your profile role from the database. HireHub will not open a workspace without a valid profiles.role.",
        );
      }
      toast.success("Welcome back", {
        description: workspaceWelcomeDescription(s.role),
      });
      goHome(s.role);
    } catch (err) {
      emailFlowRef.current = false;
      toast.error(formatAuthErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function onGoogle() {
    if (busy || oauthClaiming) return;
    clearGoogleBusySafetyTimer();
    setBusy("google");
    // Silent backup if the page never unloads after a successful OAuth URL assign.
    googleBusySafetyTimer.current = setTimeout(() => {
      setBusy((current) => (current === "google" ? null : current));
    }, GOOGLE_OAUTH_START_TIMEOUT_MS + 2_000);

    try {
      // Supabase Google OAuth cannot attach `options.data` (unlike email signup).
      // Sign up carries the selected role via sessionStorage and redirectTo.
      // Sign in carries neither, so an existing profiles.role is left unchanged.
      // Requires Google provider enabled and redirect URLs allowlisted — see
      // GOOGLE_OAUTH_REDIRECT_URLS in src/lib/assignment-verification.ts.
      emailFlowRef.current = false;
      let redirectTo: string;
      if (mode === "signup") {
        const signupRole = parseSignupRole(role);
        if (!signupRole) {
          throw new Error("Choose Job Seeker or Recruiter before continuing with Google.");
        }
        clearOAuthSignInAttempt();
        stashOAuthSignupRole(signupRole);
        redirectTo = buildGoogleOAuthRedirectTo({
          origin: window.location.origin,
          mode: "signup",
          role: signupRole,
          ...(search.redirect ? { redirect: search.redirect } : {}),
        });
      } else {
        clearOAuthSignupRole();
        markOAuthSignInAttempt();
        redirectTo = buildGoogleOAuthRedirectTo({
          origin: window.location.origin,
          mode: "signin",
          ...(search.redirect ? { redirect: search.redirect } : {}),
        });
      }
      const { data, error } = await withTimeout(
        supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo,
            skipBrowserRedirect: true,
          },
        }),
        GOOGLE_OAUTH_START_TIMEOUT_MS,
        "Google sign-in timed out before redirect. Check your connection and try again.",
      );
      if (error) throw error;
      if (!data?.url) {
        throw new Error("Google sign-in did not return a redirect URL. Try again.");
      }
      // Controlled navigation so we keep busy until the document unloads.
      window.location.assign(data.url);
    } catch (err) {
      clearGoogleBusySafetyTimer();
      clearOAuthSignupRole();
      clearOAuthSignInAttempt();
      toast.error("Google sign-in didn't work", { description: formatAuthErrorMessage(err) });
      setBusy(null);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <Logo />
          <Button variant="ghost" size="sm" asChild>
            <Link
              to="/"
              onClick={(e) => {
                if (typeof window !== "undefined" && window.location.pathname === "/") {
                  e.preventDefault();
                  window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
                }
              }}
            >
              <ArrowLeft /> Home
            </Link>
          </Button>
        </div>
        <div className="mx-auto my-auto w-full max-w-sm animate-fade-up py-12">
          <h1 className="font-display text-4xl">{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signin"
              ? "Sign in with email or Google. Existing Job Seeker, Recruiter, and Admin accounts keep their saved workspace."
              : "Choose Job Seeker or Recruiter, then sign up with email or Google."}
          </p>

          {mode === "signup" && search.intent && (
            <p className="mt-4 rounded-lg border border-signal/25 bg-signal-soft/50 px-3 py-2 text-sm text-foreground">
              <span className="font-medium">{AUTH_INTENT_LABEL[search.intent]}</span>
              <span className="text-muted-foreground">
                {" — create your account as a "}
                {search.intent === "recruiter" ? "recruiter" : "job seeker"}.
              </span>
            </p>
          )}

          <div className="mt-8 grid grid-cols-2 rounded-lg bg-signal-soft/70 p-1 text-sm ring-1 ring-signal/15" role="tablist">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  setErrors({});
                  setNotice(null);
                  if (claimRecovery) dismissClaimRecovery();
                  if (m === "signin") clearOAuthSignupRole();
                }}
                className={cn(
                  "rounded-md py-2 font-medium transition-all",
                  mode === m
                    ? "bg-signal text-signal-foreground shadow-signal"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "signin" ? "Sign in" : "Sign up"}
              </button>
            ))}
          </div>

          {notice && (
            <div role="status" className="mt-6 flex gap-3 rounded-xl border border-signal/30 bg-signal-soft p-4 text-sm">
              <MailCheck className="mt-0.5 size-4 shrink-0 text-signal" />
              <p>{notice}</p>
            </div>
          )}

          {profileError && !loading && !user && (
            <div role="alert" className="mt-6 space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <p className="text-destructive">{profileError}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void signOut()}>
                Sign out and try again
              </Button>
            </div>
          )}

          {claimRecovery && (
            <div
              role="alert"
              className="mt-6 space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
            >
              <p className="font-medium text-destructive">Could not finish recruiter signup</p>
              <p className="text-muted-foreground">
                {recruiterClaimRecoveryMessage(claimRecovery.kind, claimRecovery.detail)}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {user ? (
                  <Button
                    type="button"
                    variant="signal"
                    size="sm"
                    onClick={() => {
                      dismissClaimRecovery();
                      redirectedRef.current = true;
                      goHome(user.role === "recruiter" ? "recruiter" : "seeker");
                    }}
                  >
                    Continue as {user.role === "recruiter" ? "Recruiter" : "Job Seeker"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void (async () => {
                      await signOut();
                      dismissClaimRecovery();
                      setMode("signup");
                      setRole("recruiter");
                      toast.message("Signed out", {
                        description: "Choose Recruiter, then Continue with Google to try again.",
                      });
                    })();
                  }}
                >
                  Sign out to retry
                </Button>
                {user ? (
                  <Button type="button" variant="outline" size="sm" asChild>
                    <Link to="/settings" onClick={() => dismissClaimRecovery()}>
                      Settings (delete & retry)
                    </Link>
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" size="sm" asChild>
                  <Link to="/support">Get support</Link>
                </Button>
              </div>
            </div>
          )}

          {mode === "signup" && (
            <fieldset className="mt-6" disabled={!!busy || oauthClaiming}>
              <legend className="mb-2 text-sm font-medium">I am a…</legend>
              <p className="mb-2 text-xs text-muted-foreground">
                Required for both email and Google signup. Job Seeker and Recruiter use the same password rules.
                Role cannot be changed later from Sign in.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {ROLES.map((r) => {
                  const Icon = r.icon;
                  const active = role === r.id;
                  return (
                    <label
                      key={r.id}
                      className={cn(
                        "cursor-pointer rounded-xl border bg-card p-3 text-center transition-all hover:border-foreground/30 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                        active && "border-signal bg-signal-soft ring-1 ring-signal",
                        (!!busy || oauthClaiming) && "pointer-events-none opacity-70",
                      )}
                    >
                      <input
                        type="radio"
                        name="role"
                        value={r.id}
                        checked={active}
                        onChange={() => setRole(r.id)}
                        className="sr-only"
                      />
                      <Icon className={cn("mx-auto size-4", active ? "text-signal" : "text-muted-foreground")} />
                      <span className="mt-1.5 block text-xs font-medium">{r.label}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{r.desc}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          <Button type="button" variant="outline" size="lg" className="mt-6 w-full bg-card" onClick={onGoogle} disabled={!!busy || oauthClaiming}>
            {busy === "google" || oauthClaiming ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
            {oauthClaiming
              ? "Checking your account…"
              : mode === "signup"
                ? `Continue with Google as ${role === "recruiter" ? "Recruiter" : "Job Seeker"}`
                : "Continue with Google"}
          </Button>
          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            {mode === "signup" && <Field id="name" label="Full name" autoComplete="name" error={errors["name"]} />}
            <Field id="email" label="Email" type="email" autoComplete="email" error={errors["email"]} />
            <Field
              id="password"
              label="Password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              error={errors["password"]}
              hint={mode === "signup" ? "At least 8 characters with letters and a number." : undefined}
            />
            {mode === "signin" && (
              <div className="-mt-2 flex justify-end">
                <Link
                  to="/forgot-password"
                  className="text-sm text-signal underline-offset-4 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
            )}

            <Button type="submit" variant="signal" size="lg" className="w-full" disabled={!!busy || oauthClaiming}>
              {busy === "form" && <Loader2 className="animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>
        </div>
      </div>

      <aside className="relative hidden overflow-hidden border-l border-signal/15 bg-surface lg:flex lg:items-center lg:justify-center">
        <div className="absolute inset-0 bg-grid" aria-hidden />
        <div className="absolute inset-0 bg-hero" aria-hidden />
        <div
          className="pointer-events-none absolute -right-20 top-16 size-72 rounded-full bg-signal/20 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -left-16 bottom-10 size-56 rounded-full bg-status-interview/20 blur-3xl"
          aria-hidden
        />
        <div className="relative w-full max-w-md px-8">
          <div className="surface-card p-6 shadow-lift">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-signal font-semibold text-signal-foreground shadow-signal">N</div>
              <div>
                <p className="text-sm font-semibold">Product Designer</p>
                <p className="text-xs text-muted-foreground">Northwind · Remote</p>
              </div>
            </div>
            <StatusTracker status="interview" />
          </div>
          <p className="mt-8 font-display text-3xl leading-snug text-foreground">“Every application, beautifully tracked — from first click to offer.”</p>
        </div>
      </aside>
    </div>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  ...props
}: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        className="h-11 rounded-lg bg-card focus-visible:ring-signal/30"
        {...props}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}
