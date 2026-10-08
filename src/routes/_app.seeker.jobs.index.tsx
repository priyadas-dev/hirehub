import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, MapPin, Search } from "lucide-react";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { JOB_TYPE_LABEL, type JobType } from "@/lib/hirehub";
import { fmtDate, supabase } from "@/components/dashboard/parts";

export const Route = createFileRoute("/_app/seeker/jobs/")({
  head: () => ({
    meta: [
      { title: "Browse Jobs — HireHub" },
      { name: "description", content: "Browse approved job listings and apply." },
    ],
  }),
  component: BrowseJobsPage,
});

function BrowseJobsPage() {
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");
  const [jobType, setJobType] = useState<JobType | "all">("all");

  const jobs = useQuery({
    queryKey: ["seeker-jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,title,location,salary_range,job_type,created_at,companies(name)")
        .eq("status", "approved")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(() => {
    const list = jobs.data ?? [];
    const qq = q.trim().toLowerCase();
    const loc = location.trim().toLowerCase();
    return list.filter((j) => {
      if (jobType !== "all" && j.job_type !== jobType) return false;
      if (loc && !(j.location ?? "").toLowerCase().includes(loc)) return false;
      if (qq) {
        const hay = `${j.title} ${j.companies?.name ?? ""}`.toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }, [jobs.data, q, location, jobType]);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Job Seeker" title="Browse jobs" description="Only admin-approved roles are listed. Open a job to apply." />

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search title or company" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Input className="sm:w-48" placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
        <Select value={jobType} onValueChange={(v) => setJobType(v as JobType | "all")}>
          <SelectTrigger className="sm:w-44">
            <SelectValue placeholder="Job type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {(Object.keys(JOB_TYPE_LABEL) as JobType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {JOB_TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {jobs.isLoading ? (
        <CardSkeleton rows={4} />
      ) : jobs.isError ? (
        <ErrorState onRetry={() => void jobs.refetch()} />
      ) : filtered.length ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {filtered.map((j) => (
            <li key={j.id} className="surface-card interactive-card flex flex-col gap-3 p-5">
              <div>
                <h2 className="font-semibold">{j.title}</h2>
                <p className="text-sm text-muted-foreground">{j.companies?.name ?? "Company"}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" /> {j.location ?? "Remote"}
                </span>
                <span className="rounded-full border px-2 py-0.5">{JOB_TYPE_LABEL[j.job_type]}</span>
                {j.salary_range && <span>{j.salary_range}</span>}
                <span>Posted {fmtDate(j.created_at)}</span>
              </div>
              <Button asChild size="sm" variant="outline" className="mt-auto w-fit">
                <Link to="/seeker/jobs/$jobId" params={{ jobId: j.id }}>
                  View & apply
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={Briefcase}
          title={jobs.data?.length ? "No matches" : "No approved jobs yet"}
          description={jobs.data?.length ? "Try a different search or filter." : "Check back after recruiters post roles and admins approve them."}
        />
      )}
    </div>
  );
}
