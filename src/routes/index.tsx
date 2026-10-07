import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Briefcase, Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/Logo";
import { StatusTracker } from "@/components/status/StatusTracker";
import { StatusBadge } from "@/components/status/StatusBadge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HireHub — Where great hires happen" },
      { name: "description", content: "HireHub connects job seekers, recruiters and teams with a calm, modern hiring experience." },
      { property: "og:title", content: "HireHub — Where great hires happen" },
      { property: "og:description", content: "A calm, modern platform for job seekers and recruiters." },
    ],
  }),
  component: Landing,
});

const ROLES = [
  { icon: Search, title: "Job Seekers", text: "Discover roles that fit and follow every application from applied to hired." },
  { icon: Briefcase, title: "Recruiters", text: "Post openings, review candidates, and move people forward with clarity." },
  { icon: ShieldCheck, title: "Admins", text: "Keep the marketplace trustworthy with oversight across users and listings." },
];

function Landing() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2">
          <Button variant="ghost" asChild><Link to="/auth">Sign in</Link></Button>
          <Button asChild><Link to="/auth" search={{ mode: "signup" }}>Get started</Link></Button>
        </nav>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grid" aria-hidden />
        <div className="absolute inset-0 bg-hero" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 text-center sm:px-6 sm:pt-24">
          <span className="inline-flex animate-fade-up items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium shadow-xs">
            <span className="size-1.5 rounded-full bg-signal" /> Hiring, without the noise
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl animate-fade-up font-display text-5xl leading-[1.05] sm:text-7xl [animation-delay:80ms]">
            Where great people meet <em className="text-signal">great work.</em>
          </h1>
          <p className="mx-auto mt-6 max-w-xl animate-fade-up text-lg text-muted-foreground [animation-delay:160ms]">
            HireHub brings job seekers and recruiters together in one calm, transparent space — so everyone always knows what happens next.
          </p>
          <div className="mt-10 flex animate-fade-up flex-wrap justify-center gap-3 [animation-delay:240ms]">
            <Button variant="signal" size="xl" asChild>
              <Link to="/auth" search={{ mode: "signup" }}>Create free account <ArrowRight /></Link>
            </Button>
            <Button variant="outline" size="xl" asChild><Link to="/auth">I have an account</Link></Button>
          </div>

          <div className="mx-auto mt-16 max-w-3xl animate-fade-up surface-card p-6 text-left shadow-lift sm:p-8 [animation-delay:320ms]">
            <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-signal-soft font-semibold text-signal">A</div>
                <div>
                  <p className="font-semibold">Senior Frontend Engineer</p>
                  <p className="text-sm text-muted-foreground">Acme Labs · Dhaka · Hybrid</p>
                </div>
              </div>
              <StatusBadge status="hired" />
            </div>
            <StatusTracker status="hired" />
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-24 sm:px-6 md:grid-cols-3">
        {ROLES.map(({ icon: Icon, title, text }) => (
          <article key={title} className="surface-card interactive-card p-6">
            <div className="flex size-10 items-center justify-center rounded-lg bg-surface text-signal ring-1 ring-border">
              <Icon className="size-5" />
            </div>
            <h2 className="mt-5 text-lg font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{text}</p>
          </article>
        ))}
      </section>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">© 2026 HireHub</footer>
    </div>
  );
}
