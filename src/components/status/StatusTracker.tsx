import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { JOURNEY, STATUS_META, type ApplicationStatus } from "./status";

const CONFETTI = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2;
  const dist = 38 + (i % 3) * 12;
  return {
    dx: `${Math.cos(angle) * dist}px`,
    dy: `${Math.sin(angle) * dist}px`,
    rot: `${i * 47}deg`,
    color: ["bg-status-hired", "bg-signal", "bg-status-shortlisted", "bg-status-interview"][i % 4],
  };
});

/**
 * Horizontal application journey: Applied → Shortlisted → Interview → Hired.
 * Animates progress fill on status change and celebrates on "hired".
 */
export function StatusTracker({ status, className }: { status: ApplicationStatus; className?: string }) {
  const rejected = status === "rejected";
  const idx = rejected ? 0 : JOURNEY.indexOf(status);
  const pct = (idx / (JOURNEY.length - 1)) * 100;

  return (
    <div className={cn("w-full", className)} role="group" aria-label={`Application status: ${STATUS_META[status].label}`}>
      <div className="relative">
        <div className="absolute left-5 right-5 top-5 h-0.5 rounded-full bg-border" aria-hidden />
        <div
          className="absolute left-5 top-5 h-0.5 rounded-full bg-signal transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ width: `calc((100% - 2.5rem) * ${pct / 100})` }}
          aria-hidden
        />
        <ol className="relative flex justify-between">
          {JOURNEY.map((s, i) => {
            const m = STATUS_META[s];
            const Icon = m.icon;
            const done = !rejected && i < idx;
            const current = !rejected && i === idx;
            const isHired = current && s === "hired";
            return (
              <li key={s} className="flex flex-col items-center gap-2" aria-current={current ? "step" : undefined}>
                <span className="relative">
                  <span
                    className={cn(
                      "relative z-10 flex size-10 items-center justify-center rounded-full border-2 bg-card transition-all duration-500",
                      done && "border-signal bg-signal text-signal-foreground",
                      current && cn(m.border, m.soft, m.text, "animate-pulse-ring scale-110"),
                      !done && !current && "border-border text-muted-foreground",
                    )}
                  >
                    {done ? <Check className="size-4 animate-pop" strokeWidth={3} /> : <Icon key={String(current)} className={cn("size-4", current && "animate-pop")} />}
                  </span>
                  {isHired && (
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
                      {CONFETTI.map((c, k) => (
                        <span
                          key={k}
                          className={cn("absolute size-1.5 rounded-[2px] animate-confetti", c.color)}
                          style={{ ["--dx" as string]: c.dx, ["--dy" as string]: c.dy, ["--rot" as string]: c.rot, animationDelay: `${k * 15}ms` }}
                        />
                      ))}
                    </span>
                  )}
                </span>
                <span className={cn("text-xs font-medium transition-colors sm:text-sm", current ? "text-foreground" : done ? "text-foreground/80" : "text-muted-foreground")}>
                  {m.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
