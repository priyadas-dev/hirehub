import { Briefcase, CheckCircle2, Clock, PlusSquare, Users } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CardSkeleton, EmptyState } from "@/components/feedback/States";
import { StatusBadge } from "@/components/status/StatusBadge";
import type { ApplicationStatus } from "@/components/status/status";
import { useAuth } from "@/lib/auth";
import { countRows, fmtDate, Section, StatCard, supabase, useCounts } from "./parts";

const soon = (what: string) => () => toast("Coming soon", { description: `${what} arrives in the next milestone.` });

export function RecruiterDashboard() {
  const { user } = useAuth();
  const id = user?.id;
  const counts = useCounts("recruiter", id, async () => {
    const jobs = () => supabase.from("jobs").select("id", { count: "exact", head: true }).eq("recruiter_id", id!);
    const apps = () => supabase.from("applications").select("id,jobs!inner(recruiter_id)", { count: "exact", head: true }).eq("jobs.recruiter_id", id!);
    const [active, pending, applicants, hired] = await Promise.all([
      countRows(() => jobs().eq("status", "approved")),
      countRows(() => jobs().eq("status", "pending")),
      countRows(() => apps()),
      countRows(() => apps().eq("status", "hired")),
    ]);
    return { active, pending, applicants, hired };
  });
  const recentJobs = useQuery({
    queryKey: ["rec-jobs", id], enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select("id,title,status,created_at,location")
        .eq("recruiter_id", id!).order("created_at", { ascending: false }).limit(5);
      if (error) throw error;
      return data;
    },
  });
  const recentApps = useQuery({
    queryKey: ["rec-apps", id], enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("applications")
        .select("id,status,created_at,jobs!inner(title,recruiter_id),profiles(full_name,email)")
        .eq("jobs.recruiter_id", id!).order("created_at", { ascending: false }).limit(5);
      if (error) throw error;
      return data;
    },
  });
  const c = counts.data;

  return (
    <div className="space-y-10">
      <header className="relative overflow-hidden rounded-2xl border bg-status-interview-soft/60 p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-status-interview">Recruiter workspace</p>
            <h1 className="mt-2 font-display text-3xl sm:text-4xl">Welcome back, {user?.name.split(" ")[0] ?? "there"}.</h1>
            <p className="mt-2 max-w-lg text-sm text-muted-foreground">Post roles, review applicants and move great people forward.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="lg" asChild>
              <Link to="/recruiter/applicants"><Users /> Applicants</Link>
            </Button>
            <Button variant="signal" size="lg" onClick={soon("Job posting")}><PlusSquare /> Post a job</Button>
          </div>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active jobs" value={c?.active} icon={Briefcase} loading={counts.isLoading} />
        <StatCard label="Pending approval" value={c?.pending} icon={Clock} tone="interview" loading={counts.isLoading} />
        <StatCard label="Total applicants" value={c?.applicants} icon={Users} tone="applied" loading={counts.isLoading} />
        <StatCard label="Hired" value={c?.hired} icon={CheckCircle2} tone="hired" loading={counts.isLoading} />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Recent job posts">
          {recentJobs.isLoading ? <CardSkeleton /> : recentJobs.data?.length ? (
            <ul className="surface-card divide-y">
              {recentJobs.data.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{j.title}</p>
                    <p className="text-xs text-muted-foreground">{j.location ?? "Remote"} · {fmtDate(j.created_at)}</p>
                  </div>
                  <span className="rounded-full border px-2.5 py-1 text-xs font-medium capitalize">{j.status}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Briefcase} title="No job posts yet" description="Your first listing will appear here once you post it."
              action={<Button variant="signal" onClick={soon("Job posting")}>Post a job</Button>} />
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
          {recentApps.isLoading ? <CardSkeleton /> : recentApps.data?.length ? (
            <ul className="surface-card divide-y">
              {recentApps.data.map((a) => (
                <li key={a.id}>
                  <Link
                    to="/recruiter/applicants"
                    search={{ applicationId: a.id }}
                    className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{a.profiles?.full_name || a.profiles?.email || "Applicant"}</p>
                      <p className="truncate text-xs text-muted-foreground">{a.jobs.title} · {fmtDate(a.created_at)}</p>
                    </div>
                    <StatusBadge status={a.status as ApplicationStatus} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Users} title="No applicants yet" description="Candidates who apply to your roles will show up here." />
          )}
        </Section>
      </div>
    </div>
  );
}
