import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Briefcase, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo, LogoMark } from "@/components/brand/Logo";
import { AboutSection } from "@/components/marketing/AboutSection";
import { ContactSection } from "@/components/marketing/ContactSection";
import { LandingFooter } from "@/components/marketing/LandingFooter";
import { StatusTracker } from "@/components/status/StatusTracker";
import { StatusBadge } from "@/components/status/StatusBadge";
import type { AuthIntent } from "@/lib/auth-intent";

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

const ROLE_CARDS: {
  icon: typeof Search;
  title: string;
  text: string;
  intent: AuthIntent;
}[] = [
  {
    icon: Search,
    title: "Job Seekers",
    text: "Discover roles that fit and follow every application from applied to hired.",
    intent: "seeker",
  },
  {
    icon: Briefcase,
    title: "Recruiters",
    text: "Post openings, review candidates, and move people forward with clarity.",
    intent: "recruiter",
  },
];

function Landing() {
  return (
    <div className="min-h-screen overflow-x-hidden">
      <header className="sticky top-0 z-40 border-b border-signal/15 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav className="flex items-center gap-1.5 sm:gap-2">
            <Button variant="ghost" asChild>
              <Link to="/auth">Sign in</Link>
            </Button>
            <Button variant="signal" asChild>
              <Link to="/auth" search={{ mode: "signup" }}>Get started</Link>
            </Button>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grid" aria-hidden />
        <div className="absolute inset-0 bg-hero" aria-hidden />
        <div
          className="pointer-events-none absolute -left-24 top-24 size-72 animate-float rounded-full bg-signal/10 blur-3xl sm:size-96"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-16 bottom-10 size-64 animate-float rounded-full bg-status-shortlisted/15 blur-3xl [animation-delay:1.2s] sm:size-80"
          aria-hidden
        />

        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-12 text-center sm:px-6 sm:pb-24 sm:pt-20">
          <div className="mb-8 flex animate-fade-up justify-center">
            <LogoMark className="size-12 rounded-xl shadow-signal sm:size-14" />
          </div>
          <p className="animate-fade-up text-sm font-semibold tracking-tight text-signal [animation-delay:40ms]">
            HireHub
          </p>
          <span className="mt-5 inline-flex animate-fade-up items-center gap-2 rounded-full border bg-card/90 px-3.5 py-1.5 text-xs font-medium shadow-xs backdrop-blur-sm [animation-delay:80ms]">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-signal opacity-60" />
              <span className="relative size-1.5 rounded-full bg-signal" />
            </span>
            Hiring, without the noise
          </span>
          <h1 className="mx-auto mt-4 max-w-[18ch] animate-fade-up font-display text-5xl sm:mt-5 sm:text-6xl [animation-delay:120ms]">
            Where great people meet <em className="text-signal not-italic">great work</em>
          </h1>
          <p className="mx-auto mt-4 max-w-[62ch] animate-fade-up text-base leading-relaxed text-muted-foreground sm:mt-5 sm:text-lg sm:leading-relaxed [animation-delay:180ms]">
            HireHub brings job seekers and recruiters together in one calm, transparent space — so everyone always knows what happens next.
          </p>
          <div className="mt-8 flex animate-fade-up flex-col items-stretch justify-center gap-3 sm:mt-10 sm:flex-row sm:flex-wrap sm:items-center [animation-delay:240ms]">
            <Button variant="signal" size="xl" className="w-full shadow-signal sm:w-auto" asChild>
              <Link to="/auth" search={{ mode: "signup" }}>Create free account <ArrowRight /></Link>
            </Button>
            <Button variant="outline" size="xl" className="w-full bg-card/70 backdrop-blur-sm sm:w-auto" asChild>
              <Link to="/auth">I have an account</Link>
            </Button>
          </div>

          <div className="relative mx-auto mt-14 max-w-3xl animate-fade-up sm:mt-16 [animation-delay:320ms]">
            <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-signal/25 via-transparent to-status-shortlisted/20 opacity-80" aria-hidden />
            <div className="relative surface-card p-5 text-left shadow-lift sm:p-8">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 sm:mb-8">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-signal-soft font-semibold text-signal ring-1 ring-signal/15">
                    A
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">Senior Frontend Engineer</p>
                    <p className="truncate text-sm text-muted-foreground">Acme Labs · Dhaka · Hybrid</p>
                  </div>
                </div>
                <StatusBadge status="hired" />
              </div>
              <StatusTracker status="hired" />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl stagger-children gap-4 px-4 pb-20 sm:px-6 sm:pb-24 md:grid-cols-2">
        {ROLE_CARDS.map(({ icon: Icon, title, text, intent }) => (
          <Link
            key={title}
            to="/auth"
            search={{ intent }}
            aria-label={`${title} — sign in or create an account`}
            className="surface-card interactive-card group block rounded-xl p-6 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-7"
          >
            <div className="flex size-11 items-center justify-center rounded-xl bg-signal-soft text-signal ring-1 ring-signal/20 transition-colors group-hover:bg-signal group-hover:text-signal-foreground group-hover:shadow-signal">
              <Icon className="size-5" aria-hidden />
            </div>
            <h2 className="mt-5 text-lg font-semibold tracking-tight">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
            <p className="mt-4 text-sm font-medium text-signal opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              Continue to sign in or sign up →
            </p>
          </Link>
        ))}
      </section>

      <AboutSection />
      <ContactSection />
      <LandingFooter />
    </div>
  );
}
