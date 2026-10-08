import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, MapPin, Search, X } from "lucide-react";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  const locationOptions = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs.data ?? []) {
      const loc = j.location?.trim();
      if (loc) set.add(loc);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [jobs.data]);

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

  const hasActiveFilters = q.trim() !== "" || location.trim() !== "" || jobType !== "all";
  const totalApproved = jobs.data?.length ?? 0;

  const clearFilters = () => {
    setQ("");
    setLocation("");
    setJobType("all");
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Job Seeker"
        title="Browse jobs"
        description="Search and filter admin-approved roles. Open a job to save or apply."
      />

      <div className="surface-card space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,11rem)]">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label htmlFor="job-search" className="text-xs text-muted-foreground">
              Search
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="job-search"
                className="pl-9"
                placeholder="Job title or company"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="job-location" className="text-xs text-muted-foreground">
              Location
            </Label>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="job-location"
                className="pl-9"
                list="job-location-options"
                placeholder="City, remote…"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                autoComplete="off"
              />
              <datalist id="job-location-options">
                {locationOptions.map((loc) => (
                  <option key={loc} value={loc} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Job type</Label>
            <Select value={jobType} onValueChange={(v) => setJobType(v as JobType | "all")}>
              <SelectTrigger className="w-full" aria-label="Filter by job type">
                <SelectValue placeholder="All types" />
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
        </div>

        <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {jobs.isLoading ? (
              "Loading jobs…"
            ) : (
              <>
                Showing{" "}
                <span className="font-medium text-foreground tabular-nums">{filtered.length}</span>
                {hasActiveFilters ? (
                  <>
                    {" "}
                    of <span className="font-medium text-foreground tabular-nums">{totalApproved}</span> approved{" "}
                    {totalApproved === 1 ? "job" : "jobs"}
                  </>
                ) : (
                  <> approved {filtered.length === 1 ? "job" : "jobs"}</>
                )}
              </>
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            disabled={!hasActiveFilters}
            onClick={clearFilters}
          >
            <X className="size-3.5" />
            Clear all filters
          </Button>
        </div>
      </div>

      {jobs.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <CardSkeleton rows={3} />
          <CardSkeleton rows={3} />
        </div>
      ) : jobs.isError ? (
        <ErrorState onRetry={() => void jobs.refetch()} />
      ) : filtered.length ? (
        <ul className="grid stagger-children gap-4 sm:grid-cols-2">
          {filtered.map((j) => (
            <li key={j.id} className="surface-card interactive-card group flex flex-col gap-4 p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-signal-soft text-signal ring-1 ring-signal/10 transition-transform duration-300 group-hover:scale-105">
                  <Briefcase className="size-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate font-semibold tracking-tight">{j.title}</h2>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">{j.companies?.name ?? "Company"}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-full border bg-surface/80 px-2 py-0.5">
                  <MapPin className="size-3" /> {j.location ?? "Remote"}
                </span>
                <span className="rounded-full border bg-surface/80 px-2 py-0.5">{JOB_TYPE_LABEL[j.job_type]}</span>
                {j.salary_range && <span className="rounded-full border bg-surface/80 px-2 py-0.5">{j.salary_range}</span>}
                <span className="rounded-full border bg-surface/80 px-2 py-0.5">Posted {fmtDate(j.created_at)}</span>
              </div>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="mt-auto w-fit transition-colors group-hover:border-signal/40 group-hover:text-signal"
              >
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
          title={totalApproved ? "No matches" : "No approved jobs yet"}
          description={
            totalApproved
              ? "Try different search terms or clear your filters."
              : "Check back after recruiters post roles and admins approve them."
          }
          action={
            hasActiveFilters ? (
              <Button variant="outline" onClick={clearFilters}>
                <X className="size-3.5" />
                Clear all filters
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
