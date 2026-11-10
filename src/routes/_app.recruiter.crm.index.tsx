import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, Users, Filter, MailOpen, Mail, Briefcase } from "lucide-react";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { summarizeCampaignTracking } from "@/lib/crm/campaigns";
import { CRM_SCHEMA_PENDING_MESSAGE, probeCrmSchemaReady } from "@/lib/crm/schema-probe";
import { listCrmCampaigns, listCrmContacts, listCrmSegments, listRecruiterRecipients } from "@/lib/crm/supabase-crm";
import { fetchCrmEmailActivity } from "@/lib/integrations/email-activity.server";
import type { EmailActivityItem } from "@/lib/integrations/email-activity";

export const Route = createFileRoute("/_app/recruiter/crm/")({
  head: () => ({
    meta: [
      { title: "CRM — HireHub" },
      { name: "description", content: "Recruiter CRM dashboard for contacts, segments, and campaigns." },
    ],
  }),
  component: CrmDashboardPage,
});

function CrmDashboardPage() {
  const { user } = useAuth();
  const id = user?.id;

  const ready = useQuery({
    queryKey: ["crm-schema-ready"],
    queryFn: probeCrmSchemaReady,
  });

  const stats = useQuery({
    queryKey: ["crm-dashboard", id],
    enabled: !!id && ready.data === true,
    queryFn: async () => {
      const [contacts, segments, campaigns, recipients] = await Promise.all([
        listCrmContacts(id!),
        listCrmSegments(id!),
        listCrmCampaigns(id!),
        listRecruiterRecipients(id!),
      ]);
      return {
        contactCount: contacts.length,
        segmentCount: segments.length,
        campaignCount: campaigns.length,
        tracking: summarizeCampaignTracking(recipients),
        recentCampaigns: campaigns.slice(0, 5),
      };
    },
  });

  // Unified email activity: application-status emails + campaign emails.
  const emailActivity = useQuery({
    queryKey: ["crm-email-activity", id],
    enabled: !!id && ready.data === true,
    queryFn: () => fetchCrmEmailActivity(),
  });

  if (ready.isLoading) return <CardSkeleton rows={4} />;
  if (ready.data === false) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Recruiter"
          title="CRM"
          description="Talent-pool outreach with segments, campaigns, and email tracking."
        />
        <EmptyState
          icon={Megaphone}
          title="CRM schema not applied"
          description={CRM_SCHEMA_PENDING_MESSAGE}
        />
      </div>
    );
  }

  if (stats.isError) {
    return <ErrorState title="Could not load CRM" onRetry={() => void stats.refetch()} />;
  }

  const agg = emailActivity.data?.aggregate;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Recruiter"
        title="CRM overview"
        description="HireHub is the source of truth for contacts and campaigns. HubSpot sync is optional."
        actions={
          <Button asChild>
            <Link to="/recruiter/crm/campaigns">New campaign</Link>
          </Button>
        }
      />

      {stats.isLoading ? (
        <CardSkeleton rows={3} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={Users} label="Contacts" value={stats.data?.contactCount ?? 0} to="/recruiter/crm/contacts" />
            <StatCard icon={Filter} label="Segments" value={stats.data?.segmentCount ?? 0} to="/recruiter/crm/segments" />
            <StatCard icon={Megaphone} label="Campaigns" value={stats.data?.campaignCount ?? 0} to="/recruiter/crm/campaigns" />
            <StatCard icon={MailOpen} label="Opened" value={agg?.opened ?? stats.data?.tracking?.opened ?? 0} to="/recruiter/crm/campaigns" />
          </div>

          {/* Unified email activity */}
          <section className="surface-card space-y-4 p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight">Email activity</h2>
              {emailActivity.isLoading && (
                <span className="text-xs text-muted-foreground">Loading…</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Sent" value={agg?.sent ?? 0} />
              <MiniStat label="Delivered" value={agg?.delivered ?? 0} />
              <MiniStat label="Opened" value={agg?.opened ?? 0} />
              <MiniStat label="Bounced" value={agg?.bounced ?? 0} />
            </div>

            {/* Recent activity list */}
            {(emailActivity.data?.recentActivity.length ?? 0) > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Recent</p>
                <ul className="divide-y rounded-lg border bg-background/60">
                  {emailActivity.data!.recentActivity.map((item) => (
                    <ActivityRow key={item.id} item={item} />
                  ))}
                </ul>
              </div>
            )}

            {emailActivity.data?.recentActivity.length === 0 && !emailActivity.isLoading && (
              <p className="text-xs text-muted-foreground">
                No email activity yet. Send a campaign or update an application status to see events here.
              </p>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight">Recent campaigns</h2>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/recruiter/crm/campaigns">View all</Link>
              </Button>
            </div>
            {(stats.data?.recentCampaigns.length ?? 0) === 0 ? (
              <EmptyState
                icon={Megaphone}
                title="No campaigns yet"
                description="Create a segment, then draft a campaign to reach your talent pool."
                action={
                  <Button asChild>
                    <Link to="/recruiter/crm/campaigns">Create campaign</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {stats.data!.recentCampaigns.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.status} · {c.subject || "No subject"}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/recruiter/crm/campaigns/$campaignId" params={{ campaignId: c.id }}>
                        Open
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  to,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  to: "/recruiter/crm/contacts" | "/recruiter/crm/segments" | "/recruiter/crm/campaigns";
}) {
  return (
    <Link to={to} className="surface-card block p-4 transition-colors hover:bg-signal-soft/30">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
    </Link>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-background/60 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  delivered: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  opened: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  bounced: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  complained: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  pending: "bg-muted text-muted-foreground",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}

function ActivityRow({ item }: { item: EmailActivityItem }) {
  const isApp = item.emailType === "application_status";
  const name = item.recipientName ?? item.recipientEmail ?? "Unknown recipient";
  const sub = item.recipientName ? item.recipientEmail : null;
  const label = item.relatedLabel;
  const ts = item.createdAt ? new Date(item.createdAt).toLocaleDateString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }) : null;

  return (
    <li className="flex items-center gap-3 px-3 py-2.5 text-sm">
      <span className="shrink-0 text-muted-foreground">
        {isApp ? <Briefcase className="size-3.5" /> : <Mail className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{name}</p>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
        {label && (
          <p className="truncate text-xs text-muted-foreground">
            {isApp ? "Job: " : "Campaign: "}{label}
          </p>
        )}
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1">
        <StatusBadge status={item.trackingStatus} />
        {ts && <span className="text-xs text-muted-foreground">{ts}</span>}
      </div>
    </li>
  );
}
