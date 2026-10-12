import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/Logo";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Forgot password — HireHub" },
      { name: "description", content: "Reset your HireHub account password." },
      { property: "og:title", content: "Forgot password — HireHub" },
      { property: "og:description", content: "Reset your HireHub account password." },
    ],
  }),
  component: ForgotPasswordPage,
});

const emailSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
});

function ForgotPasswordPage() {
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = emailSchema.safeParse({ email: fd.get("email") });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid email");
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      // Origin matches the host serving HireHub (localhost or deployed URL).
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
        redirectTo,
      });
      if (resetError) throw resetError;
      setSentTo(parsed.data.email);
      toast.success("Check your email for a reset link");
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
            <Link to="/auth"><ArrowLeft /> Sign in</Link>
          </Button>
        </div>
        <div className="mx-auto my-auto w-full max-w-sm animate-fade-up py-12">
          <h1 className="font-display text-4xl">Forgot password?</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your account email and we&apos;ll send a link to choose a new password.
          </p>

          {sentTo ? (
            <div role="status" className="mt-8 space-y-6">
              <div className="flex gap-3 rounded-xl border border-signal/30 bg-signal-soft p-4 text-sm">
                <MailCheck className="mt-0.5 size-4 shrink-0 text-signal" />
                <p>
                  If an account exists for <span className="font-medium">{sentTo}</span>, you&apos;ll
                  receive a reset link shortly. Open it on this same HireHub site to continue.
                </p>
              </div>
              <Button variant="signal" size="lg" className="w-full" asChild>
                <Link to="/auth">Back to sign in</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={!!error}
                  aria-describedby={error ? "email-err" : undefined}
                  className="h-11 rounded-lg bg-card focus-visible:ring-signal/30"
                />
                {error && <p id="email-err" className="text-xs text-destructive">{error}</p>}
              </div>
              <Button type="submit" variant="signal" size="lg" className="w-full" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                Send reset link
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
            “Secure access to your hiring workspace — reset and get back to work.”
          </p>
        </div>
      </aside>
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
  if (m.includes("rate limit") || m.includes("too many") || m.includes("429")) {
    return "Too many reset emails. Wait 30–60 minutes, or sign in with Google / set a password in the Supabase Dashboard.";
  }
  if (m.includes("fetch") || m.includes("network")) return "Can't reach the server. Check your connection and try again.";
  if (m.includes("redirect")) return "Password reset redirect isn't allowlisted yet. Ask an admin to add this site's /reset-password URL in Supabase Auth settings.";
  return msg || "Something went wrong. Please try again.";
}
