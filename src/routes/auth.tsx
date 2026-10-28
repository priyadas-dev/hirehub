import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Briefcase, Loader2, MailCheck, Search } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/Logo";
import { StatusTracker } from "@/components/status/StatusTracker";
import {
  ProfileSessionError,
  ROLE_HOME,
  resolvePostAuthPath,
  useAuth,
  workspaceWelcomeDescription,
  type Role,
} from "@/lib/auth";
import {
  AUTH_INTENT_LABEL,
  intentToSignupRole,
  parseAuthIntent,
  type AuthIntent,
  type SignupRole,
} from "@/lib/auth-intent";
import { signUpWithAccountEmail } from "@/lib/account-password";
import { claimOAuthSignupRole } from "@/lib/claim-oauth-signup-role";
import {
  buildGoogleOAuthRedirectTo,
  clearOAuthSignupRole,
  resolvePendingOAuthSignupRole,
  stashOAuthSignupRole,
  takeOAuthSignupRole,
} from "@/lib/oauth-signup-role";
import { sendAccountMail } from "@/lib/send-account-mail";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): {
    redirect?: string;
    mode?: "signup";
    intent?: AuthIntent;
    error?: string;
    error_description?: string;
  } => {
    const intent = parseAuthIntent(s["intent"]);
    return {
      ...(typeof s["redirect"] === "string" ? { redirect: s["redirect"] } : {}),
      ...(s["mode"] === "signup" ? { mode: "signup" as const } : {}),
      ...(intent ? { intent } : {}),
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
  component: AuthPage,
});

const ROLES: { id: SignupRole; label: string; desc: string; icon: typeof Search }[] = [
  { id: "job_seeker", label: "Job Seeker", desc: "Find and apply to roles", icon: Search },
  { id: "recruiter", label: "Recruiter", desc: "Post jobs, hire talent", icon: Briefcase },
];

const schema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(8, "At least 8 characters").max(128),
});

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
  const postAuthHandled = useRef(false);
  const mailAccount = useServerFn(sendAccountMail);
  const claimGoogleSignupRole = useServerFn(claimOAuthSignupRole);
  const { user, loading, profileError, refresh, signOut } = useAuth();
  const navigate = useNavigate();

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

  // Surface OAuth provider failures returned by Supabase on redirect
  // (e.g. /auth?error=server_error&error_description=failed+to+exchange...).
  useEffect(() => {
    if (!search.error) return;
    const detail = (search.error_description ?? search.error).replace(/\+/g, " ");
    toast.error("Google sign-in didn't work", {
      description:
        detail.toLowerCase().includes("exchange authorization code")
          ? "Supabase could not finish Google's token exchange. Check that the Google Client ID and Client Secret match on project munqgybiuqpncxbgfvdp, and that Google Cloud allows https://munqgybiuqpncxbgfvdp.supabase.co/auth/v1/callback."
          : detail,
    });
    navigate({
      to: "/auth",
      search: {
        ...(search.redirect ? { redirect: search.redirect } : {}),
        ...(search.mode ? { mode: search.mode } : {}),
        ...(search.intent ? { intent: search.intent } : {}),
      },
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.error, search.error_description]);

  // Already signed in (including after returning from Google) → claim OAuth signup
  // role if needed, then go to the verified profiles.role workspace.
  // Wait until auth finished loading so we never redirect with a stale/wrong role.
  useEffect(() => {
    if (loading || oauthClaiming || postAuthHandled.current) return;
    if (!user) return;

    let cancelled = false;
    postAuthHandled.current = true;

    void (async () => {
      const pending = resolvePendingOAuthSignupRole({
        stashedRole: takeOAuthSignupRole(),
        intent: search.intent,
        mode: search.mode === "signup" || mode === "signup" ? "signup" : "signin",
      });

      if (pending === "recruiter") {
        setOauthClaiming(true);
        try {
          const claimed = await claimGoogleSignupRole({ data: { requestedRole: "recruiter" } });
          if (cancelled) return;
          if (!claimed.ok) {
            toast.error("Could not finish recruiter signup", { description: claimed.message });
          }
          const s = await refresh();
          if (cancelled) return;
          if (s) {
            if (claimed.ok && claimed.applied) {
              toast.success("Welcome to HireHub", {
                description: workspaceWelcomeDescription(s.role),
              });
            }
            goHome(s.role);
            return;
          }
        } catch (err) {
          if (!cancelled) {
            postAuthHandled.current = false;
            toast.error(friendly(err));
          }
        } finally {
          clearOAuthSignupRole();
          if (!cancelled) setOauthClaiming(false);
        }
      }

      if (!cancelled) goHome(user.role);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading]);

  useEffect(() => {
    if (loading || !profileError) return;
    toast.error("Could not open your workspace", { description: profileError });
  }, [loading, profileError]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    const parsed = schema.safeParse({
      name: mode === "signup" ? fd.get("name") : "Member",
      email,
      password: fd.get("password"),
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
      return;
    }
    setErrors({});
    setNotice(null);
    setBusy("form");
    try {
      if (mode === "signup") {
        const { data, error } = await signUpWithAccountEmail({
          email: parsed.data.email,
          password: parsed.data.password,
          fullName: parsed.data.name,
          requestedRole: role,
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
              ? `We sent a confirmation email to ${parsed.data.email}. Open it to activate your account, then sign in.`
              : `Your account was created. ${mailed.message} You can also use Continue with Google.`,
          );
          toast.success(mailed.ok ? "Check your email to confirm your account" : "Account created");
          setMode("signin");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
        if (error) throw error;
      }
      const s = await refresh();
      if (!s) {
        throw new ProfileSessionError(
          "profile_missing",
          "Could not load your profile role from the database. HireHub will not open a workspace without a valid profiles.role.",
        );
      }
      toast.success(mode === "signup" ? "Welcome to HireHub" : "Welcome back", {
        description: workspaceWelcomeDescription(s.role),
      });
      goHome(s.role);
    } catch (err) {
      toast.error(friendly(err));
    } finally {
      setBusy(null);
    }
  }

  async function onGoogle() {
    setBusy("google");
    try {
      // Supabase Google OAuth cannot attach `options.data` (unlike email signup),
      // so the selected role is carried via redirectTo ?intent= + sessionStorage
      // and applied once after callback for new Google users only.
      // Requires Google provider enabled and redirect URLs allowlisted — see
      // GOOGLE_OAUTH_REDIRECT_URLS in src/lib/assignment-verification.ts.
      if (mode === "signup") {
        stashOAuthSignupRole(role);
      } else {
        clearOAuthSignupRole();
      }
      const redirectTo = buildGoogleOAuthRedirectTo({
        origin: window.location.origin,
        mode,
        role,
        ...(search.redirect ? { redirect: search.redirect } : {}),
        ...(search.intent ? { intent: search.intent } : {}),
      });
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (error) throw error;
      // Browser navigates to Google; session is restored on return to /auth.
    } catch (err) {
      clearOAuthSignupRole();
      toast.error("Google sign-in didn't work", { description: friendly(err) });
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
            {mode === "signin" ? "Sign in to continue to your workspace." : "Start hiring or get hired in minutes."}
          </p>

          {search.intent && (
            <p className="mt-4 rounded-lg border border-signal/25 bg-signal-soft/50 px-3 py-2 text-sm text-foreground">
              <span className="font-medium">{AUTH_INTENT_LABEL[search.intent]}</span>
              <span className="text-muted-foreground">
                {mode === "signup" ? " — create your account as a " : " — signing in as a "}
                {search.intent === "recruiter" ? "recruiter" : "job seeker"}
                {mode === "signin" ? ". Your workspace follows your saved profile role." : "."}
              </span>
            </p>
          )}

          <div className="mt-8 grid grid-cols-2 rounded-lg bg-signal-soft/70 p-1 text-sm ring-1 ring-signal/15" role="tablist">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => { setMode(m); setErrors({}); }}
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

          <Button type="button" variant="outline" size="lg" className="mt-6 w-full bg-card" onClick={onGoogle} disabled={!!busy}>
            {busy === "google" ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
            Continue with Google
          </Button>
          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or with email <span className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            {mode === "signup" && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">I am a…</legend>
              <div className="grid grid-cols-2 gap-2">
                {ROLES.map((r) => {
                  const Icon = r.icon;
                  const active = role === r.id;
                  return (
                    <label key={r.id} className={cn("cursor-pointer rounded-xl border bg-card p-3 text-center transition-all hover:border-foreground/30 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", active && "border-signal bg-signal-soft ring-1 ring-signal")}>
                      <input type="radio" name="role" value={r.id} checked={active} onChange={() => setRole(r.id)} className="sr-only" />
                      <Icon className={cn("mx-auto size-4", active ? "text-signal" : "text-muted-foreground")} />
                      <span className="mt-1.5 block text-xs font-medium">{r.label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            )}

            {mode === "signup" && <Field id="name" label="Full name" autoComplete="name" error={errors["name"]} />}
            <Field id="email" label="Email" type="email" autoComplete="email" error={errors["email"]} />
            <Field id="password" label="Password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} error={errors["password"]} />
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

            <Button type="submit" variant="signal" size="lg" className="w-full" disabled={!!busy}>
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

function Field({ id, label, error, ...props }: { id: string; label: string; error?: string | undefined } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} className="h-11 rounded-lg bg-card focus-visible:ring-signal/30" {...props} />
      {error && <p id={`${id}-err`} className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function friendly(err: unknown): string {
  if (err instanceof ProfileSessionError) return err.message;
  const msg = err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : "";
  const status =
    typeof err === "object" && err && "status" in err ? Number((err as { status: unknown }).status) : undefined;
  const m = msg.toLowerCase();
  if (status === 429 || m.includes("rate limit") || m.includes("too many") || m.includes("429")) {
    return "Too many signup/reset attempts. Wait 30–60 minutes, then use Continue with Google or a different email.";
  }
  if (m.includes("invalid login") || m.includes("invalid credentials")) {
    return "That email and password don't match. If you signed up with Google, use Continue with Google instead.";
  }
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "An account with this email already exists. Try signing in or Continue with Google.";
  }
  if (m.includes("email not confirmed")) return "Please confirm your email first — check your inbox for the link.";
  if (m.includes("password") && (m.includes("weak") || m.includes("pwned") || m.includes("least") || m.includes("characters"))) {
    return "That password is too weak. Use at least 8 characters and avoid common passwords.";
  }
  if (m.includes("over_email_send_rate_limit") || (m.includes("email") && m.includes("rate limit"))) {
    return "Too many confirmation emails sent. Wait about an hour, check spam, or sign in with Google. For local demo you can turn off Confirm email in Supabase Auth → Providers → Email.";
  }
  if (m.includes("fetch") || m.includes("network")) return "Can't reach the server. Check your connection and try again.";
  return msg || "Something went wrong. Please try again.";
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
