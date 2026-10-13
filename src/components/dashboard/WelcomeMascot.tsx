import { cn } from "@/lib/utils";

export type WelcomeMascotPhase = "enter" | "idle" | "farewell" | "exit";

interface WelcomeMascotProps {
  phase: WelcomeMascotPhase;
  className?: string;
}

/**
 * HireHub buddy. The waving arm lives in a nested SVG so CSS rotate around the
 * shoulder pivot is visible (whole-body SVG motion alone is not enough).
 */
export function WelcomeMascot({ phase, className }: WelcomeMascotProps) {
  const waving = phase === "enter" || phase === "idle" || phase === "farewell";

  return (
    <div
      className={cn(
        "hh-welcome-mascot relative shrink-0 overflow-visible",
        waving && "hh-welcome-mascot--waving",
        phase === "idle" && "hh-welcome-mascot--idle",
        phase === "farewell" && "hh-welcome-mascot--farewell",
        phase === "exit" && "hh-welcome-mascot--exit",
        className,
      )}
      aria-hidden
    >
      <svg
        viewBox="0 0 160 168"
        className="hh-welcome-svg size-[7.25rem] overflow-visible sm:size-32"
        role="presentation"
      >
        <defs>
          <linearGradient id="hh-buddy-body" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--signal-soft)" />
            <stop offset="100%" stopColor="color-mix(in oklab, var(--signal) 22%, white)" />
          </linearGradient>
          <linearGradient id="hh-buddy-face" x1="30%" y1="0%" x2="70%" y2="100%">
            <stop offset="0%" stopColor="#fff8f0" />
            <stop offset="100%" stopColor="#f3e4d4" />
          </linearGradient>
        </defs>

        <ellipse cx="80" cy="158" rx="42" ry="7" className="hh-welcome-shadow fill-foreground/10" />

        {/* Body + head bounce as one unit (arm is outside so it can wave independently). */}
        <g className="hh-welcome-body">
          <ellipse cx="80" cy="118" rx="38" ry="32" fill="url(#hh-buddy-body)" stroke="var(--signal)" strokeWidth="2.5" />
          <rect x="64" y="108" width="32" height="22" rx="4" fill="var(--signal)" />
          <rect x="74" y="104" width="12" height="6" rx="2" fill="var(--signal-foreground)" opacity="0.9" />
          <path d="M72 119h16" stroke="var(--signal-foreground)" strokeWidth="2" strokeLinecap="round" opacity="0.7" />

          {/* Left arm (resting) */}
          <path
            d="M46 108c-10 6-16 16-14 24"
            fill="none"
            stroke="url(#hh-buddy-face)"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <circle cx="32" cy="132" r="7" fill="url(#hh-buddy-face)" stroke="#e8d5c4" strokeWidth="1.5" />

          <circle cx="80" cy="58" r="36" fill="url(#hh-buddy-face)" stroke="#e8d5c4" strokeWidth="2" />
          <path
            d="M62 34c6-14 18-18 28-12 4-8 14-10 20-4-10 2-16 8-18 16-8-6-18-6-30 0z"
            fill="var(--signal)"
            opacity="0.85"
          />
          <ellipse cx="56" cy="68" rx="7" ry="4.5" fill="color-mix(in oklab, var(--status-hired) 35%, transparent)" />
          <ellipse cx="104" cy="68" rx="7" ry="4.5" fill="color-mix(in oklab, var(--status-hired) 35%, transparent)" />
          <ellipse cx="66" cy="56" rx="5" ry="6" fill="var(--foreground)" />
          <ellipse cx="94" cy="56" rx="5" ry="6" fill="var(--foreground)" />
          <circle cx="64.5" cy="53.5" r="1.6" fill="white" />
          <circle cx="92.5" cy="53.5" r="1.6" fill="white" />
          <path
            d="M66 74c4 8 24 8 28 0"
            fill="none"
            stroke="var(--foreground)"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </g>

        {/*
          Nested SVG at the shoulder: CSS transform-origin works reliably on
          <svg> elements, so the arm rotates around the pivot instead of the
          whole character sliding.
        */}
        <svg x="110" y="94" width="56" height="56" viewBox="0 0 56 56" overflow="visible" className="hh-welcome-arm-root">
          <g className="hh-welcome-arm">
            <path
              d="M8 12c14-12 28-10 34 4"
              fill="none"
              stroke="url(#hh-buddy-face)"
              strokeWidth="10"
              strokeLinecap="round"
            />
            <circle cx="44" cy="16" r="8" fill="url(#hh-buddy-face)" stroke="#e8d5c4" strokeWidth="1.5" />
            <path
              d="M50 10c2-4 5-5 7-4M54 16c3-2 6-1 7 1M52 22c2-1 5 0 6 2"
              fill="none"
              stroke="#e8d5c4"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </g>
        </svg>
      </svg>
    </div>
  );
}
