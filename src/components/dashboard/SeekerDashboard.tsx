import { Bookmark, Briefcase, CalendarClock, FileText, MapPin, Sparkles, Star, UserCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { StatusTracker } from "@/components/status/StatusTracker";
import { StatusBadge } from "@/components/status/StatusBadge";
import type { ApplicationStatus } from "@/components/status/status";
import { useAuth } from "@/lib/auth";
import { countRows, fmtDate, Section, StatCard, supabase, useCounts } from "./parts";

export function SeekerDashboard() {
  const { user } = useAuth();
  const id = user?.id;
  const counts = useCounts("seeker", id, async () => {
    const apps = () => supabase.from("applications").select("id", { count: "exact", head: true }).eq("seeker_id", id!);
    const [applications, shortlisted, interviews, saved] = await Promise.all([
      countRows(() => apps()),
      countRows(() => apps().eq("status", "shortlisted")),
      countRows(() => apps().eq("status", "interview")),
      countRows(() => supabase.from("saved_jobs").select("id", { count: "exact", head: true }).eq("seeker_id", id!)),
    ]);
    return { applications, shortlisted, interviews, saved };
  });
  const recent = useQuery({
    queryKey: ["seeker-recent", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id,status,created_at,jobs(title,location,companies(name))")
        .eq("seeker_id", id!)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });
  const recommended = useQuery({
    queryKey: ["seeker-recommended"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,title,location,job_type,companies(name)")
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(4);
      if (error) throw error;
      return data;
    },
  });
  const latest = recent.data?.[0]?.status as ApplicationStatus | undefined;
  const c = counts.data;

  return (
    <div className="space-y-8 sm:space-y-10">
      <PageHeader
        eyebrow="Job Seeker workspace"
        title={`Good to see you, ${user?.name.split(" ")[0] ?? "there"}.`}
        description="Track applications, save roles, and keep your profile ready to apply."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/seeker/saved"><Bookmark /> Saved</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/seeker/profile"><UserCircle /> Profile</Link>
            </Button>
            <Button variant="signal" size="sm" asChild>
              <Link to="/seeker/jobs"><Briefcase /> Browse jobs</Link>
            </Button>
          </div>
        }
      />

      <div className="grid stagger-children gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link to="/seeker/applications" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard label="Applications" value={c?.applications} icon={FileText} tone="applied" loading={counts.isLoading} />
        </Link>
        <Link to="/seeker/applications" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard label="Shortlisted" value={c?.shortlisted} icon={Star} tone="shortlisted" loading={counts.isLoading} />
        </Link>
        <Link to="/seeker/applications" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard label="Interviews" value={c?.interviews} icon={CalendarClock} tone="interview" loading={counts.isLoading} />
        </Link>
        <Link to="/seeker/saved" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard label="Saved jobs" value={c?.saved} icon={Bookmark} loading={counts.isLoading} />
        </Link>
      </div>

      <section className="surface-card relative overflow-hidden p-5 sm:p-8" aria-labelledby="journey">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-signal-soft/40 to-transparent" aria-hidden />
        <div className="relative mb-6 flex flex-wrap items-center justify-between gap-3 sm:mb-8">
          <div>
            <h2 id="journey" className="text-lg font-semibold tracking-tight">Application journey</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {latest
                ? "Where your most recent application stands."
                : "Applied → Shortlisted → Interview → Hired. Your tracker appears after you apply."}
            </p>
          </div>
          {latest ? (
            <StatusBadge status={latest} />
          ) : (
            <Button size="sm" variant="outline" asChild>
              <Link to="/seeker/jobs">Find a role</Link>
            </Button>
          )}
        </div>
        <StatusTracker
          status={latest ?? "applied"}
          className={latest ? "relative mx-auto max-w-2xl" : "relative mx-auto max-w-2xl opacity-55"}
        />
      </section>

      <div className="grid gap-8 lg:grid-cols-5">
        <Section
          title="Recent applications"
          className="lg:col-span-3"
          action={
            <Button size="sm" variant="outline" asChild>
              <Link to="/seeker/applications">View all</Link>
            </Button>
          }
        >
          {recent.isLoading ? (
            <CardSkeleton />
          ) : recent.isError ? (
            <ErrorState onRetry={() => void recent.refetch()} />
          ) : recent.data && recent.data.length > 0 ? (
            <ul className="surface-card divide-y overflow-hidden">
              {recent.data.map((a) => (
                <li key={a.id}>
                  <Link
                    to="/seeker/applications/$applicationId"
                    params={{ applicationId: a.id }}
                    className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium tracking-tight">{a.jobs?.title ?? "Job"}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {a.jobs?.companies?.name ?? "Company"}
                        {a.jobs?.location ? ` · ${a.jobs.location}` : ""} · Applied {fmtDate(a.created_at)}
                      </p>
                    </div>
                    <StatusBadge status={a.status as ApplicationStatus} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={FileText}
              title="No applications yet"
              description="Browse approved jobs and submit your first application to start tracking."
              action={
                <Button variant="signal" asChild>
                  <Link to="/seeker/jobs">Browse jobs</Link>
                </Button>
              }
            />
          )}
        </Section>

        <Section
          title="Latest approved jobs"
          description="Fresh roles to explore"
          className="lg:col-span-2"
          action={
            <Button size="sm" variant="outline" asChild>
              <Link to="/seeker/jobs">See all</Link>
            </Button>
          }
        >
          <div className="space-y-3">
            {recommended.isLoading ? (
              <CardSkeleton rows={2} />
            ) : recommended.isError ? (
              <ErrorState onRetry={() => void recommended.refetch()} />
            ) : recommended.data?.length ? (
              recommended.data.map((j) => (
                <Link
                  key={j.id}
                  to="/seeker/jobs/$jobId"
                  params={{ jobId: j.id }}
                  className="surface-card interactive-card flex items-start gap-4 p-4"
                >
                  <div className="flex size-10 items-center justify-center rounded-xl bg-signal-soft text-signal ring-1 ring-signal/10">
                    <Briefcase className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium tracking-tight">{j.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" /> {j.location ?? "Remote"}
                      </span>
                      {j.companies?.name ? <span>· {j.companies.name}</span> : null}
                    </p>
                  </div>
                </Link>
              ))
            ) : (
              <div className="rounded-xl border border-dashed bg-surface/60 p-5 text-center text-sm text-muted-foreground">
                <Sparkles className="mx-auto mb-2 size-4 text-signal" />
                Approved roles will show up here as they are posted.
                <div className="mt-3">
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/seeker/jobs">Browse jobs</Link>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}
