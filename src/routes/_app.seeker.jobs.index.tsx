import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, Briefcase, ExternalLink, MapPin, Search, X } from "lucide-react";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BROWSE_JOB_TYPE_LABEL,
  fetchLiveJobs,
  filterLocationSuggestions,
  JOB_CATEGORIES,
  matchesBrowseJobType,
  matchesCategory,
  matchesLocation,
  mergeLocationSuggestions,
  normalizeBrowseJobTypeKey,
  type BrowseJobType,
  type JobCategory,
  type LiveJob,
} from "@/lib/job-discovery";
import { JOB_TYPE_LABEL, type JobType } from "@/lib/hirehub";
import { fmtDeadline, resolveJobDeadline, stripDeadlineMarker } from "@/lib/job-fields";
import { fmtDate, supabase } from "@/components/dashboard/parts";

export const Route = createFileRoute("/_app/seeker/jobs/")({
  head: () => ({
    meta: [
      { title: "Browse Jobs ΓÇö HireHub" },
      { name: "description", content: "Discover HireHub and live external remote roles." },
    ],
  }),
  component: BrowseJobsPage,
});

function BrowseJobsPage() {
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");
  const [locationOpen, setLocationOpen] = useState(false);
  const [category, setCategory] = useState<JobCategory | "all">("all");
  const [jobType, setJobType] = useState<BrowseJobType | "all">("all");
  const locationWrapRef = useRef<HTMLDivElement>(null);

  const jobs = useQuery({
    queryKey: ["seeker-jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,title,description,location,salary_range,job_type,created_at,application_deadline,companies(name)")
        .eq("status", "approved")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const liveJobs = useQuery({
    queryKey: ["live-jobs-remotive"],
    queryFn: fetchLiveJobs,
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
    retry: 1,
  });

  const locationOptions = useMemo(
    () =>
      mergeLocationSuggestions(
        (jobs.data ?? []).map((j) => j.location),
        (liveJobs.data ?? []).map((j) => j.location),
      ),
    [jobs.data, liveJobs.data],
  );

  const locationSuggestions = useMemo(
    () => filterLocationSuggestions(locationOptions, location),
    [locationOptions, location],
  );

  const filteredHireHub = useMemo(() => {
    const list = jobs.data ?? [];
    const qq = q.trim().toLowerCase();
    return list.filter((j) => {
      if (!matchesBrowseJobType(j.job_type, j.location, jobType)) return false;
      if (!matchesLocation(j.location, location)) return false;
      const plainDescription = stripDeadlineMarker(j.description);
      const text = `${j.title} ${plainDescription} ${j.companies?.name ?? ""}`;
      if (!matchesCategory(text, undefined, category)) return false;
      if (qq) {
        const hay = `${j.title} ${j.companies?.name ?? ""} ${j.location ?? ""}`.toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }, [jobs.data, q, location, category, jobType]);

  const filteredLive = useMemo(() => {
    const list = liveJobs.data ?? [];
    const qq = q.trim().toLowerCase();
    return list.filter((j) => {
      if (
        !matchesBrowseJobType(normalizeBrowseJobTypeKey(j.jobType), j.location, jobType, {
          treatAsRemoteBoard: true,
        })
      ) {
        return false;
      }
      if (!matchesLocation(j.location, location)) return false;
      const text = `${j.title} ${j.company} ${j.category}`;
      if (!matchesCategory(text, j.category, category)) return false;
      if (qq) {
        const hay = `${j.title} ${j.company} ${j.category} ${j.location}`.toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }, [liveJobs.data, q, location, category, jobType]);

  const hasActiveFilters =
    q.trim() !== "" || location.trim() !== "" || category !== "all" || jobType !== "all";
  const hireHubTotal = jobs.data?.length ?? 0;
  const liveTotal = liveJobs.data?.length ?? 0;

  const clearFilters = () => {
    setQ("");
    setLocation("");
    setCategory("all");
    setJobType("all");
    setLocationOpen(false);
  };

  const pickLocation = (value: string) => {
    setLocation(value);
    setLocationOpen(false);
  };

  return (
    <div className="space-y-8 sm:space-y-10">
      <PageHeader
        eyebrow="Job Seeker"
        title="Browse jobs"
        description="Search HireHub roles and live external openings. Filters apply to both sections."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/seeker/saved">
                <Bookmark /> Saved
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/seeker/applications">Applications</Link>
            </Button>
          </div>
        }
      />

      <div className="surface-card space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2 xl:col-span-1">
            <Label htmlFor="job-search" className="text-xs text-muted-foreground">
              Search
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="job-search"
                className="pl-9"
                placeholder="Title, company, skillsΓÇª"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-1.5" ref={locationWrapRef}>
            <Label htmlFor="job-location" className="text-xs text-muted-foreground">
              Location
            </Label>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="job-location"
                className="pl-9"
                placeholder="City, country, or RemoteΓÇª"
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  setLocationOpen(true);
                }}
                onFocus={() => setLocationOpen(true)}
                onBlur={() => {
                  // Allow click on suggestion before closing
                  window.setTimeout(() => {
                    if (!locationWrapRef.current?.contains(document.activeElement)) {
                      setLocationOpen(false);
                    }
                  }, 120);
                }}
                autoComplete="off"
                role="combobox"
                aria-expanded={locationOpen}
                aria-controls="job-location-suggestions"
                aria-autocomplete="list"
              />
              {locationOpen && locationSuggestions.length > 0 && (
                <ul
                  id="job-location-suggestions"
                  role="listbox"
                  className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border bg-popover p-1 shadow-card"
                >
                  {locationSuggestions.map((loc) => (
                    <li key={loc} role="option">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickLocation(loc)}
                      >
                        <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                        {loc}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <Button
                type="button"
                size="sm"
                variant={location.trim().toLowerCase() === "remote" ? "signal" : "outline"}
                className="h-7 px-2.5 text-xs"
                onClick={() => pickLocation("Remote")}
              >
                Remote
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as JobCategory | "all")}>
              <SelectTrigger className="w-full" aria-label="Filter by category">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">All categories</SelectItem>
                {JOB_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Job type</Label>
            <Select value={jobType} onValueChange={(v) => setJobType(v as BrowseJobType | "all")}>
              <SelectTrigger className="w-full" aria-label="Filter by job type">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {(Object.keys(BROWSE_JOB_TYPE_LABEL) as BrowseJobType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {BROWSE_JOB_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {jobs.isLoading && liveJobs.isLoading ? (
              "Loading jobsΓÇª"
            ) : (
              <>
                <span className="font-medium text-foreground tabular-nums">{filteredHireHub.length}</span> HireHub
                {" ┬╖ "}
                <span className="font-medium text-foreground tabular-nums">{filteredLive.length}</span> live external
                {hasActiveFilters ? (
                  <>
                    {" "}
                    (of {hireHubTotal} + {liveTotal})
                  </>
                ) : null}
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
            Clear filters
          </Button>
        </div>
      </div>

      <section className="space-y-4" aria-labelledby="hirehub-jobs-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="hirehub-jobs-heading" className="text-lg font-semibold tracking-tight">
              HireHub Jobs
            </h2>
            <p className="text-sm text-muted-foreground">
              Admin-approved roles. Save and apply through HireHub.
            </p>
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {jobs.isLoading ? "ΓÇª" : `${filteredHireHub.length} result${filteredHireHub.length === 1 ? "" : "s"}`}
          </p>
        </div>

        {jobs.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <CardSkeleton rows={3} />
            <CardSkeleton rows={3} />
          </div>
        ) : jobs.isError ? (
          <ErrorState onRetry={() => void jobs.refetch()} />
        ) : filteredHireHub.length ? (
          <ul className="grid stagger-children gap-4 sm:grid-cols-2">
            {filteredHireHub.map((j) => (
              <li key={j.id} className="surface-card interactive-card group flex flex-col gap-4 p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-signal-soft text-signal ring-1 ring-signal/10 transition-transform duration-300 group-hover:scale-105">
                    <Briefcase className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-signal">HireHub</p>
                    <h3 className="truncate font-semibold tracking-tight">{j.title}</h3>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {j.companies?.name ?? "Company"}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded-full border bg-surface/80 px-2 py-0.5">
                    <MapPin className="size-3" /> {j.location ?? "Remote"}
                  </span>
                  <span className="rounded-full border bg-surface/80 px-2 py-0.5">
                    {JOB_TYPE_LABEL[j.job_type as JobType]}
                  </span>
                  {j.salary_range && (
                    <span className="rounded-full border bg-surface/80 px-2 py-0.5">{j.salary_range}</span>
                  )}
                  <span className="rounded-full border bg-surface/80 px-2 py-0.5">Posted {fmtDate(j.created_at)}</span>
                  {(() => {
                    const label = fmtDeadline(resolveJobDeadline(j.application_deadline, j.description));
                    return label ? (
                      <span className="rounded-full border bg-surface/80 px-2 py-0.5">Deadline {label}</span>
                    ) : null;
                  })()}
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
            title={hireHubTotal ? "No HireHub matches" : "No approved HireHub jobs yet"}
            description={
              hireHubTotal
                ? "Try different filters or clear them to see all approved roles."
                : "Check back after recruiters post roles and admins approve them."
            }
            action={
              hasActiveFilters ? (
                <Button variant="outline" onClick={clearFilters}>
                  <X className="size-3.5" />
                  Clear filters
                </Button>
              ) : undefined
            }
            className="py-10"
          />
        )}
      </section>

      <section className="space-y-4" aria-labelledby="live-jobs-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="live-jobs-heading" className="text-lg font-semibold tracking-tight">
              Live Jobs / External
            </h2>
            <p className="text-sm text-muted-foreground">
              Real-time remote openings from{" "}
              <a
                href="https://remotive.com"
                target="_blank"
                rel="noreferrer"
                className="text-signal underline-offset-2 hover:underline"
              >
                Remotive
              </a>
              . External only ΓÇö not saved to HireHub and not applied through HireHub.
            </p>
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {liveJobs.isLoading ? "ΓÇª" : `${filteredLive.length} result${filteredLive.length === 1 ? "" : "s"}`}
          </p>
        </div>

        {liveJobs.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <CardSkeleton rows={3} />
            <CardSkeleton rows={3} />
          </div>
        ) : liveJobs.isError ? (
          <ErrorState
            title="Could not load live external jobs"
            description="Remotive is temporarily unavailable. HireHub jobs above still work."
            onRetry={() => void liveJobs.refetch()}
          />
        ) : filteredLive.length ? (
          <ul className="grid stagger-children gap-4 sm:grid-cols-2">
            {filteredLive.map((j) => (
              <LiveJobCard key={j.id} job={j} />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={ExternalLink}
            title={liveTotal ? "No live external matches" : "No live external jobs right now"}
            description={
              liveTotal
                ? "Adjust search, location, category, or job type to see more Remotive roles."
                : "Try again later for fresh remote listings from Remotive."
            }
            action={
              hasActiveFilters ? (
                <Button variant="outline" onClick={clearFilters}>
                  <X className="size-3.5" />
                  Clear filters
                </Button>
              ) : undefined
            }
            className="py-10"
          />
        )}
      </section>
    </div>
  );
}

function LiveJobCard({ job }: { job: LiveJob }) {
  return (
    <li className="surface-card interactive-card group flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-status-interview">
            Live / External
          </p>
          <h3 className="font-semibold leading-snug tracking-tight">{job.title}</h3>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{job.company}</p>
        </div>
        <span className="shrink-0 rounded-full border border-status-interview/30 bg-status-interview-soft/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-status-interview">
          {job.source}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full border bg-surface/80 px-2 py-0.5">
          <MapPin className="size-3" /> {job.location}
        </span>
        <span className="rounded-full border bg-surface/80 px-2 py-0.5">{job.jobType}</span>
        <span className="rounded-full border bg-surface/80 px-2 py-0.5">{job.category}</span>
        <span className="rounded-full border bg-surface/80 px-2 py-0.5">Posted {fmtDate(job.postedAt)}</span>
      </div>
      <Button
        asChild
        size="sm"
        variant="outline"
        className="mt-auto w-fit transition-colors group-hover:border-signal/40 group-hover:text-signal"
      >
        <a href={job.url} target="_blank" rel="noreferrer">
          View Job <ExternalLink className="size-3.5" />
        </a>
      </Button>
    </li>
  );
}
