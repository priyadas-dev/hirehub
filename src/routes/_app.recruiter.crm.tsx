import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const CRM_TABS = [
  { to: "/recruiter/crm", label: "Overview", exact: true },
  { to: "/recruiter/crm/contacts", label: "Contacts" },
  { to: "/recruiter/crm/segments", label: "Segments" },
  { to: "/recruiter/crm/campaigns", label: "Campaigns" },
] as const;

export const Route = createFileRoute("/_app/recruiter/crm")({
  component: CrmLayout,
});

function CrmLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname }).replace(/\/+$/, "") || "/";

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-2 border-b border-border/60 pb-3" aria-label="CRM sections">
        {CRM_TABS.map((tab) => {
          const active = tab.exact
            ? pathname === tab.to || pathname === `${tab.to}/`
            : pathname === tab.to || pathname.startsWith(`${tab.to}/`);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "bg-signal-soft text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <Outlet />
    </div>
  );
}
