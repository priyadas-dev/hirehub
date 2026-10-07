import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Briefcase, Loader2, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/Logo";
import { StatusTracker } from "@/components/status/StatusTracker";
import { useAuth, type Role } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
    mode: s.mode === "signup" ? ("signup" as const) : undefined,
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

const ROLES: { id: Role; label: string; desc: string; icon: typeof Search }[] = [
  { id: "seeker", label: "Job Seeker", desc: "Find and apply to roles", icon: Search },
  { id: "recruiter", label: "Recruiter", desc: "Post jobs, hire talent", icon: Briefcase },
  { id: "admin", label: "Admin", desc: "Manage the platform", icon: ShieldCheck },
];

const schema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(8, "At least 8 characters").max(128),
});

function AuthPage() {
  const search = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">(search.mode === "signup" ? "signup" : "signin");
  const [role, setRole] = useState<Role>("seeker");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    const parsed = schema.safeParse({
      name: mode === "signup" ? fd.get("name") : email.split("@")[0] || "Member",
      email,
      password: fd.get("password"),
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    setTimeout(() => {
      const raw = parsed.data.name;
      signIn({ name: raw.charAt(0).toUpperCase() + raw.slice(1), email: parsed.data.email, role });
      toast.success(mode === "signup" ? "Welcome to HireHub" : "Welcome back");
      navigate({ to: "/dashboard", replace: true });
    }, 700);
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <Logo />
          <Button variant="ghost" size="sm" asChild>
            <Link to="/"><ArrowLeft /> Home</Link>
          </Button>
        </div>
        <div className="mx-auto my-auto w-full max-w-sm animate-fade-up py-12">
          <h1 className="font-display text-4xl">{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signin" ? "Sign in to continue to your workspace." : "Start hiring or get hired in minutes."}
          </p>

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

          <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">I am a…</legend>
              <div className="grid grid-cols-3 gap-2">
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

            {mode === "signup" && <Field id="name" label="Full name" autoComplete="name" error={errors.name} />}
            <Field id="email" label="Email" type="email" autoComplete="email" error={errors.email} />
            <Field id="password" label="Password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} error={errors.password} />

            <Button type="submit" variant="signal" size="lg" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
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

function Field({ id, label, error, ...props }: { id: string; label: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} className="h-11 rounded-lg bg-card focus-visible:ring-signal/30" {...props} />
      {error && <p id={`${id}-err`} className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
