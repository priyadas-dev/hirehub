import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WelcomeMascot } from "@/components/dashboard/WelcomeMascot";
import {
  canShowRoleWelcome,
  claimRoleWelcomePresentation,
  firstNameFromFullName,
  noteRoleWelcomeEffectCleanup,
  prefersReducedMotion,
  ROLE_WELCOME_EXIT_MS,
  ROLE_WELCOME_FAREWELL_MS,
  ROLE_WELCOME_HOLD_MS,
  ROLE_WELCOME_REDUCED_HOLD_MS,
  welcomeSubtitleForRole,
  type WelcomeRole,
} from "@/lib/role-welcome";
import { cn } from "@/lib/utils";

type Phase = "enter" | "idle" | "farewell" | "exit";

interface RoleWelcomeProps {
  userId: string;
  fullName: string;
  role: WelcomeRole;
  /** Override for tests. */
  forceShow?: boolean;
}

/**
 * Once-per-login-session cartoon welcome for recruiters and job seekers.
 * Fixed top-right overlay — does not affect dashboard layout.
 */
export function RoleWelcome({ userId, fullName, role, forceShow = false }: RoleWelcomeProps) {
  const titleId = useId();
  const [phase, setPhase] = useState<Phase | "gone">("gone");
  const timers = useRef<number[]>([]);
  const firstName = firstNameFromFullName(fullName);
  const subtitle = welcomeSubtitleForRole(role);

  const clearTimers = () => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  };

  const schedule = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const beginExit = (withFarewell: boolean) => {
    clearTimers();
    const reduced = prefersReducedMotion();
    if (withFarewell && !reduced) {
      setPhase("farewell");
      schedule(() => {
        setPhase("exit");
        schedule(() => setPhase("gone"), ROLE_WELCOME_EXIT_MS);
      }, ROLE_WELCOME_FAREWELL_MS);
      return;
    }
    setPhase("exit");
    schedule(() => setPhase("gone"), reduced ? 120 : ROLE_WELCOME_EXIT_MS);
  };

  useEffect(() => {
    if (!userId || !canShowRoleWelcome(role)) return;
    if (!claimRoleWelcomePresentation(userId, forceShow)) return;

    clearTimers();
    setPhase("enter");

    const reduced = prefersReducedMotion();
    const hold = reduced ? ROLE_WELCOME_REDUCED_HOLD_MS : ROLE_WELCOME_HOLD_MS;

    schedule(() => setPhase("idle"), reduced ? 50 : 560);
    schedule(() => beginExit(true), hold);

    return () => {
      clearTimers();
      noteRoleWelcomeEffectCleanup(userId);
    };
    // beginExit is stable enough for this mount lifecycle; deps are identity gates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, role, forceShow]);

  if (phase === "gone") return null;

  return (
    <div
      data-testid="role-welcome"
      data-phase={phase}
      className={cn(
        "pointer-events-none fixed right-3 top-16 z-40 w-[min(100%-1.5rem,22rem)] sm:right-5 sm:top-[4.5rem] sm:w-[min(100%-2.5rem,24rem)]",
        phase === "enter" && "hh-welcome-shell--enter",
        phase === "exit" && "hh-welcome-shell--exit",
      )}
    >
      <aside
        role="status"
        aria-live="polite"
        aria-labelledby={titleId}
        className={cn(
          "pointer-events-auto relative flex items-center gap-3 overflow-visible rounded-2xl border border-signal/25 bg-card/95 p-3.5 shadow-lift backdrop-blur-sm sm:gap-4 sm:p-4",
          "hh-welcome-card",
          phase === "enter" && "hh-welcome-card--enter",
          phase === "idle" && "hh-welcome-card--idle",
          phase === "farewell" && "hh-welcome-card--farewell",
          phase === "exit" && "hh-welcome-card--exit",
        )}
      >
        <WelcomeMascot phase={phase} />

        <div className="min-w-0 flex-1 pr-6">
          <p id={titleId} className="font-display text-xl leading-snug tracking-tight text-foreground sm:text-2xl">
            Welcome, {firstName}!
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1.5 top-1.5 size-8 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss welcome"
          onClick={() => beginExit(false)}
        >
          <X className="size-4" />
        </Button>
      </aside>
    </div>
  );
}
