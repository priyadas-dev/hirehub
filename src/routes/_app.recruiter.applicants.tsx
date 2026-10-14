import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Users } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { ResumeOpenLink } from "@/components/applications/ResumeOpenLink";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { StatusBadge } from "@/components/status/StatusBadge";
import { StatusTracker } from "@/components/status/StatusTracker";
import { STATUS_META, type ApplicationStatus } from "@/components/status/status";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { nextApplicationStatuses, STATUS_ACTION_LABEL } from "@/lib/hirehub";
import { isMissingSchemaError } from "@/lib/hirehub-storage";
import { updateApplicationStatusWithNotification } from "@/lib/notify-application-status";
import { useAuth } from "@/lib/auth";
import { fmtDate, supabase } from "@/components/dashboard/parts";

const searchSchema = z.object({
  jobId: z.string().optional(),
  status: z.enum(["applied", "shortlisted", "interview", "hired", "rejected"]).optional(),
  applicationId: z.string().optional(),
});

const PIPELINE: ApplicationStatus[] = ["applied", "shortlisted", "interview", "hired", "rejected"];

export const Route = createFileRoute("/_app/recruiter/applicants")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Applicants — HireHub" },
      { name: "description", content: "Review applicants and move them through the hiring pipeline." },
    ],
  }),
  component: ApplicantsPage,
});

function ApplicantsPage() {
  const { user } = useAuth();
  const id = user?.id;
  const search = useSearch({ from: "/_app/recruiter/applicants" });
  const qc = useQueryClient();
  const navigate = Route.useNavigate();

  const jobs = useQuery({
    queryKey: ["recruiter-jobs-lite", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,title,status")
        .eq("recruiter_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const apps = useQuery({
    queryKey: ["recruiter-applicants", id, search.jobId, search.status],
    enabled: !!id,
    queryFn: async () => {
      const selectFull =
        "id,status,created_at,cover_note,resume_url,resume_storage_path,resume_file_name,portfolio_url,seeker_id,jobs!inner(id,title,recruiter_id),profiles(full_name,email)";
      const selectLegacy =
        "id,status,created_at,cover_note,resume_url,seeker_id,jobs!inner(id,title,recruiter_id),profiles(full_name,email)";

      let q = supabase
        .from("applications")
        .select(selectFull)
        .eq("jobs.recruiter_id", id!)
        .order("created_at", { ascending: false });
      if (search.jobId) q = q.eq("job_id", search.jobId);
      if (search.status) q = q.eq("status", search.status);
      const { data, error } = await q;
      if (error && isMissingSchemaError(error.message)) {
        let legacy = supabase
          .from("applications")
          .select(selectLegacy)
          .eq("jobs.recruiter_id", id!)
          .order("created_at", { ascending: false });
        if (search.jobId) legacy = legacy.eq("job_id", search.jobId);
        if (search.status) legacy = legacy.eq("status", search.status);
        const fallback = await legacy;
        if (fallback.error) throw fallback.error;
        return (fallback.data ?? []).map((row) => ({
          ...row,
          resume_storage_path: null as string | null,
          resume_file_name: null as string | null,
          portfolio_url: null as string | null,
        }));
      }
      if (error) throw error;
      return data;
    },
  });

  const pipelineCounts = useQuery({
    queryKey: ["recruiter-pipeline-counts", id, search.jobId],
    enabled: !!id,
    queryFn: async () => {
      let q = supabase
        .from("applications")
        .select("status,jobs!inner(recruiter_id)")
        .eq("jobs.recruiter_id", id!);
      if (search.jobId) q = q.eq("job_id", search.jobId);
      const { data, error } = await q;
      if (error) throw error;
      const counts: Record<ApplicationStatus, number> = {
        applied: 0,
        shortlisted: 0,
        interview: 0,
        hired: 0,
        rejected: 0,
      };
      for (const row of data ?? []) {
        const s = row.status as ApplicationStatus;
        if (s in counts) counts[s] += 1;
      }
      return counts;
    },
  });

  const selected = apps.data?.find((a) => a.id === search.applicationId) ?? apps.data?.[0];
  const hasFilters = !!(search.jobId || search.status);
  const selectedJobTitle = jobs.data?.find((j) => j.id === search.jobId)?.title;

  const updateStatus = useMutation({
    mutationFn: (input: {
      applicationId: string;
      from: ApplicationStatus;
      status: ApplicationStatus;
    }) => updateApplicationStatusWithNotification(input),
    onSuccess: async () => {
      toast.success("Application status updated");
      await qc.invalidateQueries({ queryKey: ["recruiter-applicants"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-pipeline-counts"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
      await qc.invalidateQueries({ queryKey: ["rec-apps"] });
      await qc.invalidateQueries({ queryKey: ["seeker-recent"] });
      await qc.invalidateQueries({ queryKey: ["seeker-applications"] });
      await qc.invalidateQueries({ queryKey: ["seeker-application"] });
      await qc.invalidateQueries({ queryKey: ["admin-applications"] });
      await qc.invalidateQueries({ queryKey: ["admin-reports"] });
      await qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: async (e: Error) => {
      // Status may already be persisted; refresh lists even when notification failed.
      await qc.invalidateQueries({ queryKey: ["recruiter-applicants"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-pipeline-counts"] });
      await qc.invalidateQueries({ queryKey: ["admin-applications"] });
      await qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.error("Could not update status", { description: e.message });
    },
  });

  const clearFilters = () =>
    void navigate({
      search: (prev) => ({
        ...prev,
        jobId: undefined,
        status: undefined,
      }),
    });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Recruiter"
        title="Applicants"
        description="Move candidates through Applied → Shortlisted → Interview → Hired / Rejected."
        actions={
          <Button variant="outline" asChild>
            <Link to="/recruiter/jobs">
              <Briefcase /> My jobs
            </Link>
          </Button>
        }
      />

      {pipelineCounts.data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {PIPELINE.map((s) => {
            const active = search.status === s;
            const count = pipelineCounts.data[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() =>
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      status: active ? undefined : s,
                    }),
                  })
                }
                className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                  active ? "border-signal/40 bg-signal-soft/50" : "bg-card hover:bg-signal-soft/40"
                }`}
              >
                <p className="text-xs text-muted-foreground">{STATUS_META[s].label}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{count}</p>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Select
          value={search.jobId ?? "all"}
          onValueChange={(v) =>
            void navigate({ search: (prev) => ({ ...prev, jobId: v === "all" ? undefined : v }) })
          }
        >
          <SelectTrigger className="w-full sm:w-[240px]">
            <SelectValue placeholder="All jobs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All jobs</SelectItem>
            {jobs.data?.map((j) => (
              <SelectItem key={j.id} value={j.id}>
                {j.title} ({j.status})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={search.status ?? "all"}
          onValueChange={(v) =>
            void navigate({
              search: (prev) => ({
                ...prev,
                status: v === "all" ? undefined : (v as ApplicationStatus),
              }),
            })
          }
        >
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {PIPELINE.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_META[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
        {!apps.isLoading && !apps.isError && (
          <p className="text-sm text-muted-foreground sm:ml-auto">
            {apps.data?.length ?? 0} result{(apps.data?.length ?? 0) === 1 ? "" : "s"}
            {selectedJobTitle ? ` · ${selectedJobTitle}` : ""}
          </p>
        )}
      </div>

      {apps.isLoading ? (
        <CardSkeleton rows={4} />
      ) : apps.isError ? (
        <ErrorState onRetry={() => void apps.refetch()} />
      ) : !apps.data?.length ? (
        <EmptyState
          icon={Users}
          title={hasFilters ? "No applicants match these filters" : "No applicants yet"}
          description={
            hasFilters
              ? "Try another job or status, or clear filters to see everyone."
              : "When seekers apply to your approved jobs, they appear here for pipeline review."
          }
          action={
            hasFilters ? (
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" asChild>
                  <Link to="/recruiter/jobs">My job posts</Link>
                </Button>
                <Button variant="signal" asChild>
                  <Link to="/recruiter/jobs/new">Post a job</Link>
                </Button>
              </div>
            )
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          <ul className="surface-card divide-y lg:col-span-2">
            {apps.data.map((a) => {
              const name = a.profiles?.full_name || a.profiles?.email || "Applicant";
              const active = selected?.id === a.id;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                      active ? "bg-signal-soft/70" : "hover:bg-signal-soft/40"
                    }`}
                    onClick={() => void navigate({ search: (prev) => ({ ...prev, applicationId: a.id }) })}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {a.jobs.title} · {fmtDate(a.created_at)}
                      </p>
                    </div>
                    <StatusBadge status={a.status as ApplicationStatus} />
                  </button>
                </li>
              );
            })}
          </ul>

          {selected && (
            <div className="surface-card space-y-6 p-5 sm:p-6 lg:col-span-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">
                    {selected.profiles?.full_name || selected.profiles?.email || "Applicant"}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {selected.profiles?.email ? `${selected.profiles.email} · ` : ""}
                    {selected.jobs.title} · Applied {fmtDate(selected.created_at)}
                  </p>
                </div>
                <StatusBadge status={selected.status as ApplicationStatus} />
              </div>
              <StatusTracker status={selected.status as ApplicationStatus} />
              <div className="space-y-2 text-sm">
                <p className="font-medium">Cover note</p>
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {selected.cover_note || "No cover note provided."}
                </p>
              </div>
              {(selected.resume_storage_path || selected.resume_url) && (
                <div className="space-y-2 text-sm">
                  <p className="font-medium">Resume</p>
                  <ResumeOpenLink
                    storagePath={selected.resume_storage_path}
                    legacyUrl={selected.resume_url}
                    fileName={selected.resume_file_name || "Open resume"}
                  />
                </div>
              )}
              {selected.portfolio_url && (
                <div className="space-y-2 text-sm">
                  <p className="font-medium">Portfolio</p>
                  <a
                    className="break-all text-signal underline"
                    href={selected.portfolio_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {selected.portfolio_url}
                  </a>
                </div>
              )}
              <div className="space-y-2">
                <p className="text-sm font-medium">Pipeline actions</p>
                <div className="flex flex-wrap gap-2">
                  {nextApplicationStatuses(selected.status as ApplicationStatus).map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={s === "rejected" ? "outline" : "signal"}
                      disabled={updateStatus.isPending}
                      onClick={() =>
                        updateStatus.mutate({
                          applicationId: selected.id,
                          from: selected.status as ApplicationStatus,
                          status: s,
                        })
                      }
                    >
                      {updateStatus.isPending ? "Updating…" : (STATUS_ACTION_LABEL[s] ?? s)}
                    </Button>
                  ))}
                  {nextApplicationStatuses(selected.status as ApplicationStatus).length === 0 && (
                    <p className="text-sm text-muted-foreground">This application is in a final status.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
