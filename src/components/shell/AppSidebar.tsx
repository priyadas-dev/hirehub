import { Link } from "@tanstack/react-router";
import { Logo } from "@/components/brand/Logo";
import { ROLE_LABEL, type Role } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { NAV } from "./nav";

export function SidebarNav({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV[role].map((item) => {
        const Icon = item.icon;
        const base = "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors";
        if (item.to) {
          return (
            <Link
              key={item.label}
              to={item.to}
              onClick={onNavigate}
              className={cn(base, "text-sidebar-foreground hover:bg-sidebar-accent")}
              activeProps={{ className: "bg-card text-foreground shadow-xs ring-1 ring-border" }}
            >
              <Icon className="size-4 text-muted-foreground group-hover:text-foreground" />
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
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-sidebar px-4 py-5 lg:flex">
      <Logo to="/dashboard" className="px-2" />
      <p className="mb-2 mt-8 px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {ROLE_LABEL[role]} workspace
      </p>
      <SidebarNav role={role} />
      <div className="mt-auto rounded-xl border bg-card p-4 shadow-xs">
        <p className="text-sm font-medium">Your journey starts here</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {role === "recruiter"
            ? "Create your company, then post jobs. Listings go live for seekers after admin approval."
            : "Use the links above to move through hiring on HireHub."}
        </p>
      </div>
    </aside>
  );
}
