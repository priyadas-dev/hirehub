import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-8 items-center justify-center rounded-lg bg-foreground text-background shadow-xs",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M6 4v16M18 4v16M6 12h12" />
      </svg>
      <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-signal" />
    </span>
  );
}

type LogoProps = {
  to?: "/" | "/seeker" | "/recruiter" | "/admin" | "/dashboard";
  className?: string;
};

export function Logo({ to = "/", className }: LogoProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isHomeTarget = to === "/";

  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      aria-label="HireHub home"
      onClick={(e) => {
        if (!isHomeTarget || pathname !== "/") return;
        e.preventDefault();
        window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      }}
    >
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-tight text-foreground">HireHub</span>
    </Link>
  );
}
