import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { CardSkeleton, ErrorState, PageHeader } from "@/components/feedback/States";
import { Section, StatCard, supabase } from "@/components/dashboard/parts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { STATUS_META, type ApplicationStatus } from "@/components/status/status";
import { useAuth } from "@/lib/auth";
import { Briefcase, Building2, FileText, Users } from "lucide-react";

export const Route = createFileRoute("/_app/admin/reports")({
  head: () => ({
    meta: [
      { title: "Reports — HireHub" },
      { name: "description", content: "Recruitment statistics across HireHub." },
    ],
  }),
  component: AdminReportsPage,
});

const STATUS_ORDER: ApplicationStatus[] = ["applied", "shortlisted", "interview", "hired", "rejected"];

const statusChartConfig = {
  count: { label: "Applications" },
  applied: { label: "Applied", color: "var(--status-applied)" },
  shortlisted: { label: "Shortlisted", color: "var(--status-shortlisted)" },
  interview: { label: "Interview", color: "var(--status-interview)" },
  hired: { label: "Hired", color: "var(--status-hired)" },
  rejected: { label: "Not selected", color: "var(--status-rejected)" },
} satisfies ChartConfig;

const roleChartConfig = {
  count: { label: "Users" },
  job_seeker: { label: "Job Seekers", color: "var(--chart-2)" },
  recruiter: { label: "Recruiters", color: "var(--chart-3)" },
  admin: { label: "Admins", color: "var(--chart-1)" },
} satisfies ChartConfig;

const jobChartConfig = {
  count: { label: "Jobs" },
  pending: { label: "Pending", color: "var(--chart-4)" },
  approved: { label: "Approved", color: "var(--chart-1)" },
  closed: { label: "Closed", color: "var(--chart-5)" },
} satisfies ChartConfig;

function AdminReportsPage() {
  const { user } = useAuth();
  const id = user?.id;

  const report = useQuery({
    queryKey: ["admin-reports", id],
    enabled: !!id,
    queryFn: async () => {
      const [apps, profiles, jobs, companies] = await Promise.all([
        supabase.from("applications").select("id,status,created_at"),
        supabase.from("profiles").select("id,role"),
        supabase.from("jobs").select("id,status"),
        supabase.from("companies").select("id,status"),
      ]);
      if (apps.error) throw apps.error;
      if (profiles.error) throw profiles.error;
      if (jobs.error) throw jobs.error;
      if (companies.error) throw companies.error;

      const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<ApplicationStatus, number>;
      for (const a of apps.data) byStatus[a.status as ApplicationStatus] += 1;

      const byRole = { job_seeker: 0, recruiter: 0, admin: 0 };
      for (const p of profiles.data) byRole[p.role] += 1;

      const byJobStatus = { pending: 0, approved: 0, closed: 0 };
      for (const j of jobs.data) byJobStatus[j.status] += 1;

      const hired = byStatus.hired;
      const totalApps = apps.data.length;
      const hireRate = totalApps ? Math.round((hired / totalApps) * 100) : 0;

      return {
        totals: {
          users: profiles.data.length,
          applications: totalApps,
          jobs: jobs.data.length,
          companies: companies.data.length,
          hireRate,
        },
        statusBars: STATUS_ORDER.map((status) => ({
          status,
          label: STATUS_META[status].label,
          count: byStatus[status],
          fill: `var(--color-${status})`,
        })),
        rolePie: (["job_seeker", "recruiter", "admin"] as const).map((role) => ({
          role,
          count: byRole[role],
          fill: `var(--color-${role})`,
        })),
        jobBars: (["pending", "approved", "closed"] as const).map((status) => ({
          status,
          label: status.charAt(0).toUpperCase() + status.slice(1),
          count: byJobStatus[status],
          fill: `var(--color-${status})`,
        })),
      };
    },
  });

  const t = report.data?.totals;

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Admin"
        title="Reports"
        description="Recruitment totals and pipeline health across the platform."
      />

      {report.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} rows={1} />
          ))}
        </div>
      ) : report.isError ? (
        <ErrorState onRetry={() => void report.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Users" value={t?.users} icon={Users} />
            <StatCard label="Applications" value={t?.applications} icon={FileText} tone="applied" />
            <StatCard label="Jobs" value={t?.jobs} icon={Briefcase} tone="interview" />
            <StatCard label="Hire rate %" value={t?.hireRate} icon={Building2} tone="hired" hint="Hired ÷ all applications" />
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            <Section title="Applications by status" description="Where candidates sit in the pipeline">
              <div className="surface-card p-4">
                <ChartContainer config={statusChartConfig} className="aspect-[4/3] w-full">
                  <BarChart data={report.data!.statusBars} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" radius={6}>
                      {report.data!.statusBars.map((row) => (
                        <Cell key={row.status} fill={row.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </div>
            </Section>

            <Section title="Users by role" description="Account mix on the platform">
              <div className="surface-card p-4">
                <ChartContainer config={roleChartConfig} className="aspect-[4/3] w-full">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent nameKey="role" hideLabel />} />
                    <Pie
                      data={report.data!.rolePie}
                      dataKey="count"
                      nameKey="role"
                      innerRadius={55}
                      outerRadius={90}
                      strokeWidth={2}
                    >
                      {report.data!.rolePie.map((row) => (
                        <Cell key={row.role} fill={row.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <ul className="mt-2 flex flex-wrap justify-center gap-3 text-xs text-muted-foreground">
                  {report.data!.rolePie.map((row) => (
                    <li key={row.role} className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: row.fill }} />
                      {roleChartConfig[row.role].label}: {row.count}
                    </li>
                  ))}
                </ul>
              </div>
            </Section>

            <Section title="Jobs by status" description="Posting lifecycle" className="lg:col-span-2">
              <div className="surface-card p-4">
                <ChartContainer config={jobChartConfig} className="aspect-[21/9] w-full max-h-64">
                  <BarChart data={report.data!.jobBars} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={80} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" radius={6}>
                      {report.data!.jobBars.map((row) => (
                        <Cell key={row.status} fill={row.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </div>
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
