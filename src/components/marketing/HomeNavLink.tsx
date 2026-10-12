import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

type HomeNavLinkProps = {
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
};

/** Navigates to `/`, or smoothly scrolls the document to the top when already home. */
export function HomeNavLink({ className, children, "aria-label": ariaLabel }: HomeNavLinkProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Link
      to="/"
      className={className}
      aria-label={ariaLabel}
      onClick={(e) => {
        if (pathname !== "/") return;
        e.preventDefault();
        window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      }}
    >
      {children}
    </Link>
  );
}
