import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { StatusBadge } from "@/components/status/StatusBadge";
import { StatusTracker } from "@/components/status/StatusTracker";
import { STATUS_META, type ApplicationStatus } from "@/components/status/status";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { nextApplicationStatuses, STATUS_ACTION_LABEL } from "@/lib/hirehub";
import { useAuth } from "@/lib/auth";
import { fmtDate, supabase } from "@/components/dashboard/parts";

const searchSchema = z.object({
  jobId: z.string().optional(),
  status: z.enum(["applied", "shortlisted", "interview", "hired", "rejected"]).optional(),
  applicationId: z.string().optional(),
});

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
        .select("id,title")
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
      let q = supabase
        .from("applications")
        .select("id,status,created_at,cover_note,resume_url,seeker_id,jobs!inner(id,title,recruiter_id),profiles(full_name,email)")
        .eq("jobs.recruiter_id", id!)
        .order("created_at", { ascending: false });
      if (search.jobId) q = q.eq("job_id", search.jobId);
      if (search.status) q = q.eq("status", search.status);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const selected = apps.data?.find((a) => a.id === search.applicationId) ?? apps.data?.[0];

  const updateStatus = useMutation({
    mutationFn: async ({
      applicationId,
      from,
      status,
    }: {
      applicationId: string;
      from: ApplicationStatus;
      status: ApplicationStatus;
    }) => {
      const allowed = nextApplicationStatuses(from);
      if (!allowed.includes(status)) {
        throw new Error(`Cannot move from ${from} to ${status}`);
      }
      const { data, error } = await supabase
        .from("applications")
        .update({ status })
        .eq("id", applicationId)
        .eq("status", from)
        .select("id");
      if (error) throw error;
      if (!data?.length) {
        throw new Error("Status was already changed. Refresh and try again.");
      }
    },
    onSuccess: async () => {
      toast.success("Application status updated");
      await qc.invalidateQueries({ queryKey: ["recruiter-applicants"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
      await qc.invalidateQueries({ queryKey: ["rec-apps"] });
      await qc.invalidateQueries({ queryKey: ["seeker-recent"] });
      await qc.invalidateQueries({ queryKey: ["seeker-applications"] });
      await qc.invalidateQueries({ queryKey: ["seeker-application"] });
      await qc.invalidateQueries({ queryKey: ["admin-applications"] });
      await qc.invalidateQueries({ queryKey: ["admin-reports"] });
    },
    onError: (e: Error) => toast.error("Could not update status", { description: e.message }),
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Recruiter"
        title="Applicants"
        description="Review applications and move candidates through Applied → Shortlisted → Interview → Hired / Rejected."
      />

      <div className="flex flex-wrap gap-3">
        <Select
          value={search.jobId ?? "all"}
          onValueChange={(v) => void navigate({ search: (prev) => ({ ...prev, jobId: v === "all" ? undefined : v }) })}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="All jobs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All jobs</SelectItem>
            {jobs.data?.map((j) => (
              <SelectItem key={j.id} value={j.id}>
                {j.title}
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
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(["applied", "shortlisted", "interview", "hired", "rejected"] as ApplicationStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_META[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {apps.isLoading ? (
        <CardSkeleton rows={4} />
      ) : apps.isError ? (
        <ErrorState onRetry={() => void apps.refetch()} />
      ) : !apps.data?.length ? (
        <EmptyState icon={Users} title="No applicants yet" description="When seekers apply to your approved jobs, they will appear here." />
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
                    className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${active ? "bg-muted/60" : "hover:bg-muted/40"}`}
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
            <div className="surface-card space-y-6 p-6 lg:col-span-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">
                    {selected.profiles?.full_name || selected.profiles?.email || "Applicant"}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {selected.jobs.title} · Applied {fmtDate(selected.created_at)}
                  </p>
                </div>
                <StatusBadge status={selected.status as ApplicationStatus} />
              </div>
              <StatusTracker status={selected.status as ApplicationStatus} />
              <div className="space-y-2 text-sm">
                <p className="font-medium">Cover note</p>
                <p className="whitespace-pre-wrap text-muted-foreground">{selected.cover_note || "No cover note provided."}</p>
              </div>
              {selected.resume_url && (
                <div className="space-y-2 text-sm">
                  <p className="font-medium">Resume</p>
                  <a className="text-signal underline break-all" href={selected.resume_url} target="_blank" rel="noreferrer">
                    Open resume link
                  </a>
                </div>
              )}
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
                    {STATUS_ACTION_LABEL[s] ?? s}
                  </Button>
                ))}
                {nextApplicationStatuses(selected.status as ApplicationStatus).length === 0 && (
                  <p className="text-sm text-muted-foreground">This application is in a final status.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
