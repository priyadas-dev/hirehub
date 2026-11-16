import { Briefcase, Building2, CheckCircle2, ChevronRight, Clock, PlusSquare, Star, Users } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { RecruiterJobMeta } from "@/components/jobs/RecruiterJobMeta";
import { StatusBadge } from "@/components/status/StatusBadge";
import type { ApplicationStatus } from "@/components/status/status";
import { applicantDisplayName } from "@/lib/ai/recruiter-agent-ui";
import { useAuth } from "@/lib/auth";
import {
  fmtDeadline,
  isApplicationDeadlinePassed,
  JOB_STATUS_BADGE_CLASS,
  JOB_STATUS_LABEL,
  resolveJobDeadline,
  type JobStatus,
} from "@/lib/job-fields";
import { cn } from "@/lib/utils";
import { RoleWelcome } from "@/components/dashboard/RoleWelcome";
import { countRows, fmtDate, LIST_LINK, Section, STAT_LINK, StatCard, supabase, useCounts } from "./parts";

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
  const companyApproved = company.data?.status === "approved";
  const companyRejected = company.data?.status === "rejected";
  const companyName = company.data?.name;
  const description =
    companyApproved && companyName
      ? `Hiring for ${companyName}. Post roles, review applicants, and move people through the pipeline.`
      : !company.isLoading && !company.isError && !companyReady
        ? "Create your company and wait for admin approval, then post a job — listings also need admin approval before seekers can apply."
        : "Post roles, review applicants, and move people through the pipeline.";

  return (
    <div className="flex flex-col gap-10 sm:gap-14">
      {user ? <RoleWelcome userId={user.id} fullName={user.name} role="recruiter" /> : null}

      <div className="flex flex-col gap-4">
        <PageHeader
          className="sm:flex-col lg:flex-row"
          title={`Welcome back, ${user?.name.split(" ")[0] ?? "there"}.`}
          description={description}
          actions={
            <>
              <Button variant="outline" size="sm" asChild>
                <Link to="/recruiter/jobs">
                  <Briefcase /> My jobs
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/recruiter/applicants">
                  <Users /> Applicants
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/recruiter/company">
                  <Building2 /> Company
                </Link>
              </Button>
              <Button variant="signal" size="sm" asChild>
                <Link to="/recruiter/jobs/new">
                  <PlusSquare /> Post a job
                </Link>
              </Button>
            </>
          }
        />
        {companyApproved && companyName ? (
          <p className="inline-flex w-fit max-w-full items-center gap-2 rounded-lg border border-status-hired/35 bg-status-hired-soft px-3 py-1.5 text-sm font-medium text-status-hired">
            <Building2 className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{companyName}</span>
            <span className="text-status-hired/80">· Approved</span>
          </p>
        ) : null}
      </div>

      {company.isError ? (
        <ErrorState
          title="Company profile could not load"
          description="We could not load your company. Try again, or open Company from the menu."
          onRetry={() => void company.refetch()}
        />
      ) : null}

      {!company.isLoading && !company.isError && !companyReady ? (
        <div
          role="status"
          className="flex flex-col gap-4 rounded-xl border border-signal/30 bg-signal-soft/80 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
        >
          <div className="flex min-w-0 gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-card text-signal ring-1 ring-signal/25">
              <Building2 className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="font-semibold tracking-tight text-foreground">Set up your company first</p>
              <p className="mt-1 max-w-[62ch] text-base leading-relaxed text-foreground/70">
                Add your company name, industry, and website. An admin must approve the company before it is fully
                active.
              </p>
            </div>
          </div>
          <Button variant="signal" className="shrink-0" asChild>
            <Link to="/recruiter/company">Create company</Link>
          </Button>
        </div>
      ) : null}

      {!company.isLoading && !company.isError && companyRejected ? (
        <div
          role="status"
          className="flex flex-col gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
        >
          <div className="flex min-w-0 gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-card text-destructive ring-1 ring-destructive/25">
              <Building2 className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="font-semibold tracking-tight text-foreground">
                {companyName ?? "Your company"} was rejected
              </p>
              <p className="mt-1 max-w-[62ch] text-base leading-relaxed text-foreground/75">
                Update the company details. An admin must approve it again before you can post jobs.
              </p>
            </div>
          </div>
          <Button variant="outline" className="shrink-0 border-destructive/30 bg-card" asChild>
            <Link to="/recruiter/company">Update company</Link>
          </Button>
        </div>
      ) : null}

      {!company.isLoading && !company.isError && companyPending ? (
        <div
          role="status"
          className="flex flex-col gap-4 rounded-xl border border-status-shortlisted/35 bg-status-shortlisted-soft p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
        >
          <div className="flex min-w-0 gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-card text-status-shortlisted ring-1 ring-status-shortlisted/25">
              <Clock className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="font-semibold tracking-tight text-foreground">Company pending admin approval</p>
              <p className="mt-1 max-w-[62ch] text-base leading-relaxed text-foreground/70">
                {company.data?.name ?? "Your company"} is waiting for an admin. You can edit the profile meanwhile.
              </p>
            </div>
          </div>
          <Button variant="outline" className="shrink-0 border-status-shortlisted/40 bg-card" asChild>
            <Link to="/recruiter/company">View company</Link>
          </Button>
        </div>
      ) : null}

      {counts.isError ? (
        <ErrorState
          title="Counts could not load"
          description="We could not load your job and applicant totals. Try again."
          onRetry={() => void counts.refetch()}
        />
      ) : (
        <div className="grid stagger-children gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Link
            to="/recruiter/jobs"
            search={{ status: "approved" }}
            className={STAT_LINK}
            aria-label={`Active jobs: ${c?.active ?? "loading"}`}
          >
            <StatCard label="Active jobs" value={c?.active} icon={Briefcase} tone="signal" loading={counts.isLoading} />
          </Link>
          <Link
            to="/recruiter/jobs"
            search={{ status: "pending" }}
            className={STAT_LINK}
            aria-label={`Pending approval: ${c?.pending ?? "loading"}`}
          >
            <StatCard
              label="Pending approval"
              value={c?.pending}
              icon={Clock}
              tone="shortlisted"
              loading={counts.isLoading}
            />
          </Link>
          <Link
            to="/recruiter/jobs"
            search={{ status: "closed" }}
            className={STAT_LINK}
            aria-label={`Closed jobs: ${c?.closed ?? "loading"}`}
          >
            <StatCard label="Closed jobs" value={c?.closed} icon={Briefcase} tone="quiet" loading={counts.isLoading} />
          </Link>
          <Link
            to="/recruiter/applicants"
            className={STAT_LINK}
            aria-label={`Total applicants: ${c?.applicants ?? "loading"}`}
          >
            <StatCard
              label="Total applicants"
              value={c?.applicants}
              icon={Users}
              tone="applied"
              loading={counts.isLoading}
            />
          </Link>
          <Link
            to="/recruiter/applicants"
            search={{ status: "shortlisted" }}
            className={STAT_LINK}
            aria-label={`Shortlisted: ${c?.shortlisted ?? "loading"}`}
          >
            <StatCard
              label="Shortlisted"
              value={c?.shortlisted}
              icon={Star}
              tone="shortlisted"
              loading={counts.isLoading}
            />
          </Link>
          <Link
            to="/recruiter/applicants"
            search={{ status: "hired" }}
            className={STAT_LINK}
            aria-label={`Hired: ${c?.hired ?? "loading"}`}
          >
            <StatCard label="Hired" value={c?.hired} icon={CheckCircle2} tone="hired" loading={counts.isLoading} />
          </Link>
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
        <Section
          title="Recent job posts"
          description="Your latest listings and where they sit in approval"
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
            <ul className="surface-card divide-y divide-signal/10 overflow-hidden">
              {recentJobs.data.map((j) => {
                const appCount = Array.isArray(j.applications) ? (j.applications[0]?.count ?? 0) : 0;
                const status = j.status as JobStatus;
                const deadline = resolveJobDeadline(j.application_deadline, j.description);
                const deadlineLabel = fmtDeadline(deadline);
                return (
                  <li key={j.id}>
                    <Link
                      to="/recruiter/jobs/$jobId"
                      params={{ jobId: j.id }}
                      className={cn(
                        LIST_LINK,
                        "flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-5",
                      )}
                    >
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="font-medium leading-snug tracking-tight text-foreground">{j.title}</p>
                        <RecruiterJobMeta
                          location={j.location}
                          createdAt={j.created_at}
                          applicantCount={appCount}
                          deadlineLabel={deadlineLabel}
                          deadlineExpired={isApplicationDeadlinePassed(deadline)}
                        />
                      </div>
                      <span className="flex shrink-0 items-center gap-2 self-start sm:mt-0.5">
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-xs font-medium",
                            JOB_STATUS_BADGE_CLASS[status],
                          )}
                        >
                          {JOB_STATUS_LABEL[status]}
                        </span>
                        <ChevronRight
                          className="size-4 text-muted-foreground transition-transform duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-signal"
                          aria-hidden
                        />
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
          description="Newest candidates across your open roles"
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
            <ul className="surface-card divide-y divide-signal/10 overflow-hidden">
              {recentApps.data.map((a) => (
                <li key={a.id}>
                  <Link
                    to="/recruiter/applicants"
                    search={{ applicationId: a.id }}
                    className={cn(LIST_LINK, "flex min-h-14 items-center justify-between gap-4 px-5 py-4")}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium tracking-tight">
                        {applicantDisplayName({
                          full_name: a.profiles?.full_name,
                          email: a.profiles?.email,
                        })}
                      </p>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {a.jobs.title} · {fmtDate(a.created_at)}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={a.status as ApplicationStatus} />
                      <ChevronRight
                        className="size-4 text-muted-foreground transition-transform duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-signal"
                        aria-hidden
                      />
                    </span>
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
