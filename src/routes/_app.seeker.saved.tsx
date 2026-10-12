import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Briefcase, MapPin } from "lucide-react";
import { toast } from "sonner";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { JOB_TYPE_LABEL } from "@/lib/hirehub";
import { useAuth } from "@/lib/auth";
import { fmtDate, supabase } from "@/components/dashboard/parts";

export const Route = createFileRoute("/_app/seeker/saved")({
  head: () => ({
    meta: [
      { title: "Saved jobs — HireHub" },
      { name: "description", content: "Jobs you bookmarked to review later." },
    ],
  }),
  component: SavedJobsPage,
});

function SavedJobsPage() {
  const { user } = useAuth();
  const id = user?.id;
  const qc = useQueryClient();

  const saved = useQuery({
    queryKey: ["seeker-saved", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_jobs")
        .select("id,created_at,job_id,jobs(id,title,location,job_type,status,companies(name))")
        .eq("seeker_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const unsave = useMutation({
    mutationFn: async (savedId: string) => {
      const { data, error } = await supabase
        .from("saved_jobs")
        .delete()
        .eq("id", savedId)
        .eq("seeker_id", id!)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Saved job was already removed.");
    },
    onSuccess: async () => {
      toast.success("Removed from saved");
      await qc.invalidateQueries({ queryKey: ["seeker-saved"] });
      await qc.invalidateQueries({ queryKey: ["seeker-saved-for-job"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
    },
    onError: (e: Error) => toast.error("Could not remove", { description: e.message }),
  });

  const count = saved.data?.length ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Job Seeker"
        title="Saved jobs"
        description="Bookmarks you can reopen when you are ready to apply."
        actions={
          <Button variant="signal" size="sm" asChild>
            <Link to="/seeker/jobs"><Briefcase /> Browse jobs</Link>
          </Button>
        }
      />

      {saved.isLoading ? (
        <CardSkeleton rows={4} />
      ) : saved.isError ? (
        <ErrorState onRetry={() => void saved.refetch()} />
      ) : saved.data?.length ? (
        <>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{count}</span> saved{" "}
            {count === 1 ? "job" : "jobs"}
          </p>
          <ul className="grid gap-4 sm:grid-cols-2">
            {saved.data.map((row) => {
              const job = row.jobs;
              const approved = job?.status === "approved";
              return (
                <li key={row.id} className="surface-card flex flex-col gap-4 p-5 sm:p-6">
                  <div className="flex items-start gap-3">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-signal-soft text-signal ring-1 ring-signal/10">
                      <Bookmark className="size-4 fill-current" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold tracking-tight">{job?.title ?? "Job"}</p>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {job?.companies?.name ?? "Company"}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1 rounded-full border bg-surface/80 px-2 py-0.5">
                      <MapPin className="size-3" /> {job?.location ?? "Remote"}
                    </span>
                    {job?.job_type && (
                      <span className="rounded-full border bg-surface/80 px-2 py-0.5">
                        {JOB_TYPE_LABEL[job.job_type]}
                      </span>
                    )}
                    <span className="rounded-full border bg-surface/80 px-2 py-0.5">
                      Saved {fmtDate(row.created_at)}
                    </span>
                    {!approved && job && (
                      <span className="rounded-full border bg-surface/80 px-2 py-0.5 capitalize">
                        {job.status}
                      </span>
                    )}
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2">
                    {approved && job?.id ? (
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/seeker/jobs/$jobId" params={{ jobId: job.id }}>
                          View & apply
                        </Link>
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={unsave.isPending}
                      onClick={() => unsave.mutate(row.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <EmptyState
          icon={Bookmark}
          title="No saved jobs yet"
          description="Browse approved roles and tap Save on any job you want to revisit later."
          action={
            <Button variant="signal" asChild>
              <Link to="/seeker/jobs">Browse jobs</Link>
            </Button>
          }
        />
      )}
    </div>
  );
}
