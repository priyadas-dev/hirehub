import { Activity, BarChart3, Briefcase, Building2, ClipboardList, FileText, ShieldCheck, Users } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { countRows, fmtDate, LIST_LINK, Section, STAT_LINK, StatCard, supabase, useCounts } from "./parts";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { AppNavPath } from "@/components/shell/nav";

const QUICK_LINKS: { label: string; description: string; to: AppNavPath; icon: LucideIcon }[] = [
  { label: "Approve jobs", description: "Review pending listings", to: "/admin/jobs", icon: ShieldCheck },
  { label: "Manage companies", description: "Approve recruiter companies", to: "/admin/companies", icon: Building2 },
  { label: "Manage users", description: "View accounts and change roles", to: "/admin/users", icon: Users },
  { label: "All applications", description: "Job, applicant, status, and date", to: "/admin/applications", icon: ClipboardList },
  { label: "Reports", description: "Recruitment stats and charts", to: "/admin/reports", icon: BarChart3 },
];

export function AdminDashboard() {
  const { user } = useAuth();
  const id = user?.id;
  const counts = useCounts("admin", id, async () => {
    const [pendingJobs, pendingCompanies, users, applications] = await Promise.all([
      countRows(() => supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "pending")),
      countRows(() => supabase.from("companies").select("id", { count: "exact", head: true }).eq("status", "pending")),
      countRows(() => supabase.from("profiles").select("id", { count: "exact", head: true })),
      countRows(() => supabase.from("applications").select("id", { count: "exact", head: true })),
    ]);
    return { pendingJobs, pendingCompanies, users, applications };
  });
  const attention = useQuery({
    queryKey: ["admin-attention", id],
    enabled: !!id,
    queryFn: async () => {
      const [j, co] = await Promise.all([
        supabase.from("jobs").select("id,title,created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(5),
        supabase.from("companies").select("id,name,created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(5),
      ]);
      if (j.error) throw j.error;
      if (co.error) throw co.error;
      return [
        ...j.data.map((x) => ({ id: x.id, kind: "Job" as const, name: x.title, at: x.created_at })),
        ...co.data.map((x) => ({ id: x.id, kind: "Company" as const, name: x.name, at: x.created_at })),
      ].sort((a, b) => b.at.localeCompare(a.at));
    },
  });
  const signups = useQuery({
    queryKey: ["admin-signups", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name,email,role,created_at")
        .order("created_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      return data;
    },
  });
  const c = counts.data;
  const roleLabel = { job_seeker: "Job Seeker", recruiter: "Recruiter", admin: "Admin" } as const;

  return (
    <div className="flex flex-col gap-10 sm:gap-14">
      <PageHeader
        title="Platform overview"
        description="Review what needs approval and keep an eye on activity across HireHub."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/users">
                <Users /> Users
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/reports">
                <BarChart3 /> Reports
              </Link>
            </Button>
            <Button variant="signal" size="sm" asChild>
              <Link to="/admin/jobs">
                <ShieldCheck /> Approve jobs
              </Link>
            </Button>
          </>
        }
      />

      {counts.isError ? (
        <ErrorState
          title="Counts could not load"
          description="We could not load platform totals. Try again."
          onRetry={() => void counts.refetch()}
        />
      ) : (
        <div className="grid stagger-children gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Link to="/admin/jobs" className={STAT_LINK} aria-label={`Pending jobs: ${c?.pendingJobs ?? "loading"}`}>
            <StatCard
              label="Pending jobs"
              value={c?.pendingJobs}
              icon={Briefcase}
              tone="shortlisted"
              loading={counts.isLoading}
            />
          </Link>
          <Link
            to="/admin/companies"
            className={STAT_LINK}
            aria-label={`Pending companies: ${c?.pendingCompanies ?? "loading"}`}
          >
            <StatCard
              label="Pending companies"
              value={c?.pendingCompanies}
              icon={Building2}
              tone="shortlisted"
              loading={counts.isLoading}
            />
          </Link>
          <Link to="/admin/users" className={STAT_LINK} aria-label={`Total users: ${c?.users ?? "loading"}`}>
            <StatCard label="Total users" value={c?.users} icon={Users} tone="signal" loading={counts.isLoading} />
          </Link>
          <Link
            to="/admin/applications"
            className={STAT_LINK}
            aria-label={`Applications: ${c?.applications ?? "loading"}`}
          >
            <StatCard
              label="Applications"
              value={c?.applications}
              icon={FileText}
              tone="applied"
              loading={counts.isLoading}
            />
          </Link>
        </div>
      )}

      <Section title="Admin tools" description="Jump into approvals, users, applications, and reports">
        <div className="grid stagger-children gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {QUICK_LINKS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="surface-card interactive-card group flex flex-col gap-3 p-5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-signal-soft text-signal ring-1 ring-signal/15 transition-transform duration-300 group-hover:scale-105">
                <item.icon className="size-4" aria-hidden />
              </span>
              <div>
                <p className="font-medium text-foreground">{item.label}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </Section>

      <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
        <Section
          title="Needs attention"
          description="Jobs and companies waiting for approval"
          action={
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/jobs">Review jobs</Link>
            </Button>
          }
        >
          {attention.isLoading ? (
            <CardSkeleton />
          ) : attention.isError ? (
            <ErrorState onRetry={() => void attention.refetch()} />
          ) : attention.data?.length ? (
            <div className="surface-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-signal/15 bg-signal-soft/30 text-left text-xs uppercase tracking-wider text-signal">
                    <th className="px-5 py-3 font-medium">Item</th>
                    <th className="px-5 py-3 font-medium">Type</th>
                    <th className="px-5 py-3 font-medium">Submitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-signal/10">
                  {attention.data.map((r) => (
                    <tr key={r.kind + r.id} className="transition-colors hover:bg-signal-soft/35">
                      <td className="px-5 py-3">
                        <Link
                          to={r.kind === "Job" ? "/admin/jobs" : "/admin/companies"}
                          className="font-medium text-foreground hover:text-signal hover:underline"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-medium ring-1",
                            r.kind === "Job"
                              ? "bg-status-shortlisted-soft text-status-shortlisted ring-status-shortlisted/20"
                              : "bg-status-applied-soft text-status-applied ring-status-applied/20",
                          )}
                        >
                          {r.kind}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(r.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={ShieldCheck} title="All clear" description="Nothing is waiting for approval right now." />
          )}
        </Section>

        <Section
          title="Recent platform activity"
          description="Latest signups"
          action={
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/users">Manage users</Link>
            </Button>
          }
        >
          {signups.isLoading ? (
            <CardSkeleton />
          ) : signups.isError ? (
            <ErrorState onRetry={() => void signups.refetch()} />
          ) : signups.data?.length ? (
            <ul className="surface-card divide-y divide-signal/10 overflow-hidden">
              {signups.data.map((p) => (
                <li key={p.id}>
                  <Link
                    to="/admin/users"
                    className={cn(LIST_LINK, "flex min-h-14 items-center justify-between gap-4 px-5 py-3.5")}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{p.full_name || p.email}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Joined {fmtDate(p.created_at)}</p>
                    </div>
                    <span
                      className={
                        p.role === "admin"
                          ? "rounded-full bg-signal-soft px-2.5 py-1 text-xs font-medium text-signal ring-1 ring-signal/20"
                          : p.role === "recruiter"
                            ? "rounded-full bg-status-interview-soft px-2.5 py-1 text-xs font-medium text-status-interview ring-1 ring-status-interview/20"
                            : "rounded-full bg-status-applied-soft px-2.5 py-1 text-xs font-medium text-status-applied ring-1 ring-status-applied/20"
                      }
                    >
                      {roleLabel[p.role]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Activity}
              title="No activity yet"
              description="New signups and platform events will appear here."
            />
          )}
        </Section>
      </div>
    </div>
  );
}
