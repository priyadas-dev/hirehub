import { Link, useRouterState } from "@tanstack/react-router";
import { Logo } from "@/components/brand/Logo";
import { ROLE_LABEL, type Role } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { NAV, type AppNavPath } from "./nav";

/** One active nav item — avoid TanStack Link prefix matching lighting parents. */
export function isNavItemActive(to: AppNavPath, pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";

  if (to === "/seeker" || to === "/recruiter" || to === "/admin") {
    return path === to;
  }

  if (to === "/recruiter/jobs/new") {
    return path === "/recruiter/jobs/new";
  }

  if (to === "/recruiter/jobs") {
    if (path === "/recruiter/jobs") return true;
    if (path.startsWith("/recruiter/jobs/new")) return false;
    return /^\/recruiter\/jobs\/[^/]+/.test(path);
  }

  if (to === "/seeker/jobs") {
    if (path === "/seeker/jobs") return true;
    return /^\/seeker\/jobs\/[^/]+/.test(path);
  }

  if (to === "/seeker/applications") {
    if (path === "/seeker/applications") return true;
    return path.startsWith("/seeker/applications/");
  }

  if (to === "/recruiter/crm") {
    if (path === "/recruiter/crm") return true;
    return path.startsWith("/recruiter/crm/");
  }

  if (to === "/admin/jobs") {
    return path === "/admin/jobs";
  }

  return path === to || path.startsWith(`${to}/`);
}

const ACTIVE =
  "bg-signal text-signal-foreground shadow-signal hover:bg-signal hover:text-signal-foreground";

export function SidebarNav({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV[role].map((item) => {
        const Icon = item.icon;
        const base = "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors";
        if (item.to) {
          const active = isNavItemActive(item.to, pathname);
          return (
            <Link
              key={item.label}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                base,
                active
                  ? ACTIVE
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className={cn("size-4", active ? "text-signal-foreground" : "text-signal group-hover:text-inherit")} />
              {item.label}
            </Link>
          );
        }
        return (
          <span key={item.label} aria-disabled className={cn(base, "cursor-default text-muted-foreground/70")}>
            <Icon className="size-4" />
            {item.label}
            {item.soon && (
              <span className="ml-auto rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wider">Soon</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function AppSidebar({ role }: { role: Role }) {
  return (
    <aside className="relative sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-5 lg:flex">
      <div className="absolute inset-y-0 left-0 w-1 bg-signal" aria-hidden />
      <Logo to="/dashboard" className="relative px-2" />
      <p className="relative mb-2 mt-8 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-signal">
        {ROLE_LABEL[role]} workspace
      </p>
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <SidebarNav role={role} />
      </div>
    </aside>
  );
}
