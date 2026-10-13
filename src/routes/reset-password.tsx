import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/Logo";
import { ROLE_HOME, useAuth } from "@/lib/auth";
import { resetPasswordSchema } from "@/lib/account-password";
import { establishPasswordRecoverySession } from "@/lib/password-recovery";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — HireHub" },
      { name: "description", content: "Choose a new password for your HireHub account." },
      { property: "og:title", content: "Reset password — HireHub" },
      { property: "og:description", content: "Choose a new password for your HireHub account." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);
  const { refresh } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function establishRecovery() {
      const result = await establishPasswordRecoverySession();
      if (cancelled) return;
      if (result.ok) {
        setReady(true);
        setLinkError(null);
      } else {
        setLinkError(result.error);
      }
      setChecking(false);
    }

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session && event === "SIGNED_IN")) {
        setReady(true);
        setLinkError(null);
        setChecking(false);
      }
    });

    void establishRecovery();
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = resetPasswordSchema.safeParse({
      newPassword: fd.get("password"),
      confirmPassword: fd.get("confirm"),
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });
      if (error) throw error;
      toast.success("Password updated");
      const s = await refresh();
      if (s) {
        navigate({ to: ROLE_HOME[s.role], replace: true });
      } else {
        navigate({ to: "/auth", replace: true });
      }
    } catch (err) {
      toast.error(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <Logo />
          <Button variant="ghost" size="sm" asChild>
            <Link to="/auth">
              <ArrowLeft /> Sign in
            </Link>
          </Button>
        </div>
        <div className="mx-auto my-auto w-full max-w-sm animate-fade-up py-12">
          <h1 className="font-display text-4xl">Set a new password</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose a strong password for your HireHub account. Passwords are stored by Supabase Auth only.
          </p>

          {checking ? (
            <div className="mt-10 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Checking reset link…
            </div>
          ) : linkError && !ready ? (
            <div className="mt-8 space-y-6">
              <p
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
              >
                {linkError}
              </p>
              <Button variant="signal" size="lg" className="w-full" asChild>
                <Link to="/forgot-password">Request a new link</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
              <Field
                id="password"
                label="New password"
                type="password"
                autoComplete="new-password"
                error={errors["newPassword"] ?? errors["password"]}
                hint="At least 8 characters with letters and a number."
              />
              <Field
                id="confirm"
                label="Confirm password"
                type="password"
                autoComplete="new-password"
                error={errors["confirmPassword"] ?? errors["confirm"]}
              />
              <Button type="submit" variant="signal" size="lg" className="w-full" disabled={busy || !ready}>
                {busy && <Loader2 className="animate-spin" />}
                Update password
              </Button>
            </form>
          )}
        </div>
      </div>

      <aside className="relative hidden overflow-hidden border-l bg-surface lg:flex lg:items-center lg:justify-center">
        <div className="absolute inset-0 bg-grid" aria-hidden />
        <div className="absolute inset-0 bg-hero" aria-hidden />
        <div className="relative w-full max-w-md px-8">
          <p className="font-display text-3xl leading-snug">
            “One secure password — then you&apos;re back to hiring and applying.”
          </p>
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

function friendly(err: unknown): string {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err && "message" in err
        ? String((err as { message: unknown }).message)
        : "";
  const m = msg.toLowerCase();
  if (
    m.includes("password") &&
    (m.includes("weak") || m.includes("pwned") || m.includes("least") || m.includes("characters") || m.includes("same"))
  ) {
    return "That password isn't allowed. Use at least 8 characters with letters and a number, and avoid reusing your old password.";
  }
  if (m.includes("session") || m.includes("not authenticated") || m.includes("jwt")) {
    return "Your reset session expired. Request a new link and try again.";
  }
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Please wait a minute and try again.";
  if (m.includes("fetch") || m.includes("network")) return "Can't reach the server. Check your connection and try again.";
  return msg || "Something went wrong. Please try again.";
}
