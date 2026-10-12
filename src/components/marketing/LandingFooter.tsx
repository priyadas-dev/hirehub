import { Link } from "@tanstack/react-router";
import { LogoMark } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { HomeNavLink } from "@/components/marketing/HomeNavLink";

export function LandingFooter() {
  return (
    <footer className="border-t border-border/80 bg-surface/40">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-3 md:gap-8 lg:py-14">
        <section className="space-y-3">
          <div className="flex items-center gap-2.5">
            <LogoMark className="size-9 rounded-lg shadow-xs" />
            <span className="font-display text-xl tracking-tight">HireHub</span>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            Connecting job seekers and recruiters through a simpler, smarter hiring experience.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-semibold tracking-tight">Quick links</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li>
              <HomeNavLink className="text-muted-foreground transition-colors hover:text-foreground">
                Home
              </HomeNavLink>
            </li>
            <li>
              <Link
                to="/auth"
                search={{ intent: "seeker" }}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Find jobs
              </Link>
            </li>
            <li>
              <Link
                to="/auth"
                search={{ intent: "recruiter" }}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                For recruiters
              </Link>
            </li>
            <li>
              <Link to="/auth" className="text-muted-foreground transition-colors hover:text-foreground">
                Sign in
              </Link>
            </li>
            <li>
              <Link
                to="/auth"
                search={{ mode: "signup" }}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Create account
              </Link>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-sm font-semibold tracking-tight">Need any support?</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Questions about jobs, vacancies, or using HireHub? We&apos;re here to help.
          </p>
          <Button variant="signal" size="sm" className="mt-5 shadow-signal" asChild>
            <Link to="/support">Contact support</Link>
          </Button>
        </section>
      </div>

      <div className="border-t border-border/60 bg-background/50">
        <div className="mx-auto max-w-6xl px-4 py-5 text-center text-xs text-muted-foreground sm:px-6 sm:text-left">
          <p>© 2026 HireHub. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
