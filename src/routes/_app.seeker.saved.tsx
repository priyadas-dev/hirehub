import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
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
      const { error } = await supabase.from("saved_jobs").delete().eq("id", savedId).eq("seeker_id", id!);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Removed from saved");
      await qc.invalidateQueries({ queryKey: ["seeker-saved"] });
      await qc.invalidateQueries({ queryKey: ["seeker-saved-for-job"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
    },
    onError: (e: Error) => toast.error("Could not remove", { description: e.message }),
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Job Seeker"
        title="Saved jobs"
        description="Bookmarks you can reopen when you are ready to apply."
      />

      {saved.isLoading ? (
        <CardSkeleton rows={4} />
      ) : saved.isError ? (
        <ErrorState onRetry={() => void saved.refetch()} />
      ) : saved.data?.length ? (
        <ul className="surface-card divide-y">
          {saved.data.map((row) => {
            const job = row.jobs;
            const approved = job?.status === "approved";
            return (
              <li key={row.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-medium">{job?.title ?? "Job"}</p>
                  <p className="text-xs text-muted-foreground">
                    {job?.companies?.name ?? "Company"}
                    {job?.location ? ` · ${job.location}` : ""}
                    {job?.job_type ? ` · ${JOB_TYPE_LABEL[job.job_type]}` : ""} · Saved {fmtDate(row.created_at)}
                    {!approved && job ? ` · ${job.status}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {approved && job?.id ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/seeker/jobs/$jobId" params={{ jobId: job.id }}>
                        View & apply
                      </Link>
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" disabled={unsave.isPending} onClick={() => unsave.mutate(row.id)}>
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={Bookmark}
          title="No saved jobs"
          description="Browse approved roles and save the ones you want to revisit."
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
