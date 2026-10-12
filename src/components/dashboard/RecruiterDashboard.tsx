import { Briefcase, Building2, CheckCircle2, Clock, PlusSquare, Star, Users } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/feedback/States";
import { StatusBadge } from "@/components/status/StatusBadge";
import type { ApplicationStatus } from "@/components/status/status";
import { useAuth } from "@/lib/auth";
import {
  fmtDeadline,
  JOB_STATUS_BADGE_CLASS,
  JOB_STATUS_LABEL,
  resolveJobDeadline,
  type JobStatus,
} from "@/lib/job-fields";
import { cn } from "@/lib/utils";
import { countRows, fmtDate, Section, StatCard, supabase, useCounts } from "./parts";

export function RecruiterDashboard() {
  const { user } = useAuth();
  const id = user?.id;
  const counts = useCounts("recruiter", id, async () => {
    const jobs = () => supabase.from("jobs").select("id", { count: "exact", head: true }).eq("recruiter_id", id!);
    const apps = () =>
      supabase
        .from("applications")
        .select("id,jobs!inner(recruiter_id)", { count: "exact", head: true })
        .eq("jobs.recruiter_id", id!);
    const [active, pending, closed, applicants, shortlisted, hired] = await Promise.all([
      countRows(() => jobs().eq("status", "approved")),
      countRows(() => jobs().eq("status", "pending")),
      countRows(() => jobs().eq("status", "closed")),
      countRows(() => apps()),
      countRows(() => apps().eq("status", "shortlisted")),
      countRows(() => apps().eq("status", "hired")),
    ]);
    return { active, pending, closed, applicants, shortlisted, hired };
  });

  const company = useQuery({
    queryKey: ["recruiter-company", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id,name,status")
        .eq("recruiter_id", id!)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const recentJobs = useQuery({
    queryKey: ["rec-jobs", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,title,status,created_at,location,description,application_deadline,applications(count)")
        .eq("recruiter_id", id!)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  const recentApps = useQuery({
    queryKey: ["rec-apps", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id,status,created_at,jobs!inner(title,recruiter_id),profiles(full_name,email)")
        .eq("jobs.recruiter_id", id!)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  const c = counts.data;
  const companyReady = !!company.data;
  const companyPending = company.data?.status === "pending";

  return (
    <div className="space-y-10">
      <header className="relative overflow-hidden rounded-2xl border bg-status-interview-soft/60 p-5 sm:p-8">
        <div
          className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-status-interview/15 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-status-interview sm:text-xs">
              Recruiter workspace
            </p>
            <h1 className="mt-2 font-display text-[1.85rem] leading-tight tracking-tight sm:text-4xl">
              Welcome back, {user?.name.split(" ")[0] ?? "there"}.
            </h1>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
              Create your company and wait for admin approval, then post a job ΓÇö listings also need admin approval
              before seekers can apply.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="signal" size="lg" asChild>
              <Link to="/recruiter/jobs/new">
                <PlusSquare /> Post a job
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link to="/recruiter/jobs">
                <Briefcase /> My jobs
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link to="/recruiter/applicants">
                <Users /> Applicants
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link to="/recruiter/company">
                <Building2 /> Company
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {!company.isLoading && !companyReady && (
        <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-status-interview/40 bg-status-interview-soft/40 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <p className="font-medium">Set up your company first</p>
            <p className="text-sm text-muted-foreground">
              Add your company name, industry, and website. An admin must approve the company before it is fully active.
            </p>
          </div>
          <Button variant="signal" asChild>
            <Link to="/recruiter/company">Create company</Link>
          </Button>
        </div>
      )}

      {!company.isLoading && companyPending && (
        <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-status-interview/40 bg-status-interview-soft/40 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <p className="font-medium">Company pending admin approval</p>
            <p className="text-sm text-muted-foreground">
              {company.data?.name ?? "Your company"} is waiting for an admin. You can edit the profile meanwhile.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/recruiter/company">View company</Link>
          </Button>
        </div>
      )}

      <div className="grid stagger-children gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Link to="/recruiter/jobs" search={{ status: "approved" }} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard label="Active jobs" value={c?.active} icon={Briefcase} loading={counts.isLoading} />
        </Link>
        <Link to="/recruiter/jobs" search={{ status: "pending" }} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard label="Pending approval" value={c?.pending} icon={Clock} tone="interview" loading={counts.isLoading} />
        </Link>
        <Link to="/recruiter/jobs" search={{ status: "closed" }} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard label="Closed jobs" value={c?.closed} icon={Briefcase} loading={counts.isLoading} />
        </Link>
        <Link to="/recruiter/applicants" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard label="Total applicants" value={c?.applicants} icon={Users} tone="applied" loading={counts.isLoading} />
        </Link>
        <Link to="/recruiter/applicants" search={{ status: "shortlisted" }} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard label="Shortlisted" value={c?.shortlisted} icon={Star} tone="shortlisted" loading={counts.isLoading} />
        </Link>
        <Link to="/recruiter/applicants" search={{ status: "hired" }} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard label="Hired" value={c?.hired} icon={CheckCircle2} tone="hired" loading={counts.isLoading} />
        </Link>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section
          title="Recent job posts"
          action={
            <Button size="sm" variant="outline" asChild>
              <Link to="/recruiter/jobs">View all</Link>
            </Button>
          }
        >
          {recentJobs.isLoading ? (
            <CardSkeleton />
          ) : recentJobs.isError ? (
            <ErrorState onRetry={() => void recentJobs.refetch()} />
          ) : recentJobs.data?.length ? (
            <ul className="surface-card divide-y">
              {recentJobs.data.map((j) => {
                const appCount = Array.isArray(j.applications) ? (j.applications[0]?.count ?? 0) : 0;
                const status = j.status as JobStatus;
                const deadline = resolveJobDeadline(j.application_deadline, j.description);
                return (
                  <li key={j.id}>
                    <Link
                      to="/recruiter/jobs/$jobId/edit"
                      params={{ jobId: j.id }}
                      className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{j.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {j.location ?? "Remote"} ┬╖ {fmtDate(j.created_at)} ┬╖ {appCount} applicant
                          {appCount === 1 ? "" : "s"}
                          {deadline ? ` ┬╖ Deadline ${fmtDeadline(deadline)}` : ""}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs font-medium",
                          JOB_STATUS_BADGE_CLASS[status],
                        )}
                      >
                        {JOB_STATUS_LABEL[status]}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={Briefcase}
              title="No job posts yet"
              description={
                companyReady
                  ? "Your first listing will appear here once you post it."
                  : "Add a company profile, then post your first role."
              }
              action={
                <Button variant="signal" asChild>
                  <Link to={companyReady ? "/recruiter/jobs/new" : "/recruiter/company"}>
                    {companyReady ? "Post a job" : "Set up company"}
                  </Link>
                </Button>
              }
            />
          )}
        </Section>
        <Section
          title="Recent applicants"
          action={
            <Button size="sm" variant="outline" asChild>
              <Link to="/recruiter/applicants">View all</Link>
            </Button>
          }
        >
          {recentApps.isLoading ? (
            <CardSkeleton />
          ) : recentApps.isError ? (
            <ErrorState onRetry={() => void recentApps.refetch()} />
          ) : recentApps.data?.length ? (
            <ul className="surface-card divide-y">
              {recentApps.data.map((a) => (
                <li key={a.id}>
                  <Link
                    to="/recruiter/applicants"
                    search={{ applicationId: a.id }}
                    className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {a.profiles?.full_name || a.profiles?.email || "Applicant"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {a.jobs.title} ┬╖ {fmtDate(a.created_at)}
                      </p>
                    </div>
                    <StatusBadge status={a.status as ApplicationStatus} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Users}
              title="No applicants yet"
              description="Once your jobs are approved and seekers apply, candidates appear here for the hiring pipeline."
              action={
                <Button variant="outline" asChild>
                  <Link to="/recruiter/jobs">My job posts</Link>
                </Button>
              }
            />
          )}
        </Section>
      </div>
    </div>
  );
}
