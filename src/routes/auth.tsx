import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Briefcase, Loader2, MailCheck, Search } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/Logo";
import { StatusTracker } from "@/components/status/StatusTracker";
import { ROLE_HOME, useAuth } from "@/lib/auth";
import {
  AUTH_INTENT_LABEL,
  intentToSignupRole,
  parseAuthIntent,
  type AuthIntent,
  type SignupRole,
} from "@/lib/auth-intent";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): {
    redirect?: string;
    mode?: "signup";
    intent?: AuthIntent;
    error?: string;
    error_description?: string;
  } => ({
    ...(typeof s["redirect"] === "string" ? { redirect: s["redirect"] } : {}),
    ...(s["mode"] === "signup" ? { mode: "signup" as const } : {}),
    ...(parseAuthIntent(s["intent"]) ? { intent: parseAuthIntent(s["intent"]) } : {}),
    ...(typeof s["error"] === "string" ? { error: s["error"] } : {}),
    ...(typeof s["error_description"] === "string" ? { error_description: s["error_description"] } : {}),
  }),
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
  const { user, refresh } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (search.intent) setRole(intentToSignupRole(search.intent));
  }, [search.intent]);

  function goHome(r: keyof typeof ROLE_HOME) {
    const dest = search.redirect;
    if (dest && dest.startsWith("/") && !dest.startsWith("//") && !dest.startsWith("/auth")) {
      window.location.assign(dest);
      return;
    }
    navigate({ to: ROLE_HOME[r], replace: true });
  }

  // Surface OAuth provider failures returned by Supabase on redirect
  // (e.g. /auth?error=server_error&error_description=failed+to+exchange...).
  useEffect(() => {
    if (!search.error) return;
    const detail = (search.error_description ?? search.error).replace(/\+/g, " ");
    toast.error("Google sign-in didn't work", {
      description:
        detail.toLowerCase().includes("exchange authorization code")
          ? "Supabase could not finish Google's token exchange. Check that the Google Client ID and Enabled Client Secret match on project rropcdqzzdcsnnifdlgp, and that Google Cloud allows https://rropcdqzzdcsnnifdlgp.supabase.co/auth/v1/callback."
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

  // Already signed in (including after returning from Google) → go to role area.
  useEffect(() => {
    if (user) goHome(user.role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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
        const { data, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth`,
            data: { full_name: parsed.data.name, requested_role: role },
          },
        });
        if (error) throw error;
        if (data.user && data.user.identities?.length === 0) {
          throw new Error("User already registered");
        }
        if (!data.session) {
          setNotice(`We sent a confirmation link to ${parsed.data.email}. Open it to activate your account, then sign in.`);
          toast.success("Check your email to confirm your account");
          setMode("signin");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
        if (error) throw error;
      }
      const s = await refresh();
      if (!s) throw new Error("Could not load your profile");
      toast.success(mode === "signup" ? "Welcome to HireHub" : "Welcome back");
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
      // Supabase Google OAuth (works on localhost + Vercel). Requires Google provider
      // enabled and redirect URLs allowlisted in Supabase Auth settings — see
      // GOOGLE_OAUTH_REDIRECT_URLS in src/lib/assignment-verification.ts.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth`,
        },
      });
      if (error) throw error;
      // Browser navigates to Google; session is restored on return to /auth.
    } catch (err) {
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

          <div className="mt-8 grid grid-cols-2 rounded-lg bg-muted p-1 text-sm" role="tablist">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => { setMode(m); setErrors({}); }}
                className={cn("rounded-md py-2 font-medium transition-all", mode === m ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")}
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
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
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

      <aside className="relative hidden overflow-hidden border-l bg-surface lg:flex lg:items-center lg:justify-center">
        <div className="absolute inset-0 bg-grid" aria-hidden />
        <div className="absolute inset-0 bg-hero" aria-hidden />
        <div className="relative w-full max-w-md px-8">
          <div className="surface-card p-6 shadow-lift">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary font-semibold text-primary-foreground">N</div>
              <div>
                <p className="text-sm font-semibold">Product Designer</p>
                <p className="text-xs text-muted-foreground">Northwind · Remote</p>
              </div>
            </div>
            <StatusTracker status="interview" />
          </div>
          <p className="mt-8 font-display text-3xl leading-snug">“Every application, beautifully tracked — from first click to offer.”</p>
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
  const msg = err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : "";
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "That email and password don't match. Please try again.";
  if (m.includes("already registered") || m.includes("already been registered")) return "An account with this email already exists. Try signing in instead.";
  if (m.includes("email not confirmed")) return "Please confirm your email first — check your inbox for the link.";
  if (m.includes("password") && (m.includes("weak") || m.includes("pwned") || m.includes("least") || m.includes("characters"))) return "That password is too weak. Use at least 8 characters and avoid common passwords.";
  if (m.includes("over_email_send_rate_limit") || (m.includes("email") && m.includes("rate limit"))) {
    return "Too many confirmation emails sent. Wait about an hour, check spam, or sign in with Google. For local demo you can turn off Confirm email in Supabase Auth → Providers → Email.";
  }
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Please wait a minute and try again.";
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
