import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CardSkeleton, ErrorState, PageHeader } from "@/components/feedback/States";
import { StatusBadge } from "@/components/status/StatusBadge";
import { StatusTracker } from "@/components/status/StatusTracker";
import type { ApplicationStatus } from "@/components/status/status";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { fmtDate, supabase } from "@/components/dashboard/parts";

export const Route = createFileRoute("/_app/seeker/applications/$applicationId")({
  head: () => ({
    meta: [{ title: "Application status — HireHub" }],
  }),
  component: ApplicationDetailPage,
});

function ApplicationDetailPage() {
  const { applicationId } = Route.useParams();
  const { user } = useAuth();
  const id = user?.id;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const app = useQuery({
    queryKey: ["seeker-application", applicationId],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id,status,created_at,cover_note,resume_url,jobs(id,title,location,companies(name))")
        .eq("id", applicationId)
        .eq("seeker_id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const withdraw = useMutation({
    mutationFn: async () => {
      if (app.data?.status !== "applied") {
        throw new Error("You can only withdraw while the status is Applied");
      }
      const { data, error } = await supabase
        .from("applications")
        .delete()
        .eq("id", applicationId)
        .eq("seeker_id", id!)
        .eq("status", "applied")
        .select("id");
      if (error) throw error;
      if (!data?.length) {
        throw new Error("Application could not be withdrawn — status may have already changed.");
      }
    },
    onSuccess: async () => {
      toast.success("Application withdrawn");
      await qc.invalidateQueries({ queryKey: ["seeker-applications"] });
      await qc.invalidateQueries({ queryKey: ["seeker-recent"] });
      await qc.invalidateQueries({ queryKey: ["seeker-app-for-job"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-applicants"] });
      void navigate({ to: "/seeker/applications" });
    },
    onError: (e: Error) => toast.error("Could not withdraw", { description: e.message }),
  });

  if (app.isLoading) return <CardSkeleton rows={5} />;
  if (app.isError) return <ErrorState onRetry={() => void app.refetch()} />;
  if (!app.data) {
    return <ErrorState title="Application not found" description="This application is missing or you do not own it." />;
  }

  const a = app.data;
  const status = a.status as ApplicationStatus;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Application"
        title={a.jobs?.title ?? "Job"}
        description={`${a.jobs?.companies?.name ?? "Company"} · Applied ${fmtDate(a.created_at)}`}
        actions={<StatusBadge status={status} />}
      />

      <section className="surface-card space-y-6 p-5 sm:p-8">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Status tracker</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Follow your progress through the hiring journey.</p>
        </div>
        <StatusTracker status={status} className="mx-auto max-w-2xl" />
      </section>

      <section className="surface-card space-y-4 p-5 sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight">Your submission</h2>
        <div className="space-y-2 text-sm">
          <p className="font-medium">Cover note</p>
          <p className="whitespace-pre-wrap text-muted-foreground">{a.cover_note || "No cover note."}</p>
        </div>
        {a.resume_url && (
          <div className="space-y-2 text-sm">
            <p className="font-medium">Resume</p>
            <a className="text-signal underline break-all" href={a.resume_url} target="_blank" rel="noreferrer">
              {a.resume_url}
            </a>
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          {a.jobs?.id && (
            <Button variant="outline" asChild>
              <Link to="/seeker/jobs/$jobId" params={{ jobId: a.jobs.id }}>
                View job
              </Link>
            </Button>
          )}
          {status === "applied" && (
            <Button variant="ghost" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>
              Withdraw application
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link to="/seeker/applications">Back to list</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
