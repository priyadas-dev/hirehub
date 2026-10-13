import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDiff } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { RejectReasonDialog } from "@/components/admin/RejectReasonDialog";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { JOB_TYPE_LABEL } from "@/lib/hirehub";
import { useAuth } from "@/lib/auth";
import { diffJobContent, type JobContentFields } from "@/lib/job-revisions";
import { adminReviewJobRevision, isReviewSchemaUnavailable } from "@/lib/review-api";
import { fmtDate, supabase } from "@/components/dashboard/parts";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  id: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_app/admin/job-revisions")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Job revisions — HireHub" },
      { name: "description", content: "Review proposed edits to approved jobs." },
    ],
  }),
  component: AdminJobRevisionsPage,
});

type RevisionRow = {
  id: string;
  job_id: string;
  status: string;
  created_at: string;
  rejection_reason: string | null;
  title: string;
  description: string | null;
  location: string | null;
  job_type: keyof typeof JOB_TYPE_LABEL;
  salary_range: string | null;
  application_deadline: string | null;
  baseline_title: string;
  baseline_description: string | null;
  baseline_location: string | null;
  baseline_job_type: keyof typeof JOB_TYPE_LABEL;
  baseline_salary_range: string | null;
  baseline_application_deadline: string | null;
  jobs: { title: string; companies: { name: string } | null } | null;
};

function AdminJobRevisionsPage() {
  const { user } = useAuth();
  const uid = user?.id;
  const qc = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [rejectId, setRejectId] = useState<string | null>(null);

  const revisions = useQuery({
    queryKey: ["admin-job-revisions", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_revisions")
        .select(
          "id,job_id,status,created_at,rejection_reason,title,description,location,job_type,salary_range,application_deadline,baseline_title,baseline_description,baseline_location,baseline_job_type,baseline_salary_range,baseline_application_deadline,jobs(title,companies(name))",
        )
        .order("created_at", { ascending: false });
      if (error) {
        if (isReviewSchemaUnavailable(error)) return { rows: [] as RevisionRow[], unavailable: true };
        throw error;
      }
      return { rows: (data ?? []) as unknown as RevisionRow[], unavailable: false };
    },
  });

  const review = useMutation({
    mutationFn: (input: { revisionId: string; decision: "approve" | "reject"; reason?: string }) =>
      adminReviewJobRevision(input),
    onSuccess: async (_, vars) => {
      toast.success(vars.decision === "approve" ? "Changes applied to live job" : "Revision rejected");
      setRejectId(null);
      await qc.invalidateQueries({ queryKey: ["admin-job-revisions"] });
      await qc.invalidateQueries({ queryKey: ["admin-jobs"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-jobs"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-job"] });
      await qc.invalidateQueries({ queryKey: ["seeker-jobs"] });
      await qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: Error) => toast.error("Could not review revision", { description: e.message }),
  });

  const pending = useMemo(
    () => revisions.data?.rows.filter((r) => r.status === "pending") ?? [],
    [revisions.data],
  );
  const selectedId = search.id ?? pending[0]?.id ?? revisions.data?.rows[0]?.id;
  const selected = revisions.data?.rows.find((r) => r.id === selectedId) ?? null;

  const diffs = useMemo(() => {
    if (!selected) return [];
    const baseline: JobContentFields = {
      title: selected.baseline_title,
      description: selected.baseline_description,
      location: selected.baseline_location,
      salary_range: selected.baseline_salary_range,
      job_type: selected.baseline_job_type,
      application_deadline: selected.baseline_application_deadline,
    };
    const proposed: JobContentFields = {
      title: selected.title,
      description: selected.description,
      location: selected.location,
      salary_range: selected.salary_range,
      job_type: selected.job_type,
      application_deadline: selected.application_deadline,
    };
    return diffJobContent(baseline, proposed);
  }, [selected]);

  if (revisions.isLoading) return <CardSkeleton rows={5} />;
  if (revisions.isError) return <ErrorState onRetry={() => void revisions.refetch()} />;

  if (revisions.data?.unavailable) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Admin"
          title="Job revisions"
          description="Review proposed edits to approved jobs without taking live listings offline."
        />
        <EmptyState
          icon={FileDiff}
          title="Revisions not enabled yet"
          description="Apply proposed migrations 0004 → 0005 → 0006a (commit) → 0006b on the database to enable job revision review. Do not run the PROPOSED_0006 pointer file."
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Job revisions"
        description="Compare before/after fields. Approving updates the live approved job; rejecting leaves it unchanged."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_1fr]">
        <section className="surface-card divide-y overflow-hidden">
          <div className="px-4 py-3 text-sm font-semibold">Pending ({pending.length})</div>
          {pending.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No pending revisions.</p>
          ) : (
            <ul>
              {pending.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className={cn(
                      "w-full px-4 py-3 text-left text-sm transition-colors hover:bg-accent/50",
                      selectedId === r.id && "bg-signal-soft/40",
                    )}
                    onClick={() =>
                      void navigate({
                        search: (prev) => ({ ...prev, id: r.id }),
                        replace: true,
                      })
                    }
                  >
                    <p className="font-medium leading-snug">{r.jobs?.title ?? r.baseline_title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {r.jobs?.companies?.name ?? "Company"} · {fmtDate(r.created_at)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-4">
          {!selected ? (
            <EmptyState icon={FileDiff} title="Select a revision" description="Choose a pending submission to compare changes." />
          ) : (
            <>
              <div className="surface-card space-y-2 p-5">
                <p className="text-lg font-semibold">{selected.jobs?.title ?? selected.baseline_title}</p>
                <p className="text-sm text-muted-foreground">
                  {selected.jobs?.companies?.name ?? "Company"} · Submitted {fmtDate(selected.created_at)} ·{" "}
                  <span className="capitalize">{selected.status}</span>
                </p>
                {selected.status === "rejected" && selected.rejection_reason && (
                  <p className="text-sm text-destructive">Reason: {selected.rejection_reason}</p>
                )}
                {selected.status === "pending" && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="signal"
                      disabled={review.isPending}
                      onClick={() => review.mutate({ revisionId: selected.id, decision: "approve" })}
                    >
                      Approve changes
                    </Button>
                    <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => setRejectId(selected.id)}>
                      Reject
                    </Button>
                  </div>
                )}
              </div>

              <div className="surface-card overflow-hidden">
                <div className="border-b px-5 py-3 text-sm font-semibold">Changed fields</div>
                {diffs.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-muted-foreground">No field differences detected.</p>
                ) : (
                  <ul className="divide-y">
                    {diffs.map((d) => (
                      <li key={d.field} className="grid gap-2 px-5 py-4 sm:grid-cols-3">
                        <p className="text-sm font-medium">{d.label}</p>
                        <div className="text-sm">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Before</p>
                          <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{d.before}</p>
                        </div>
                        <div className="text-sm">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">After</p>
                          <p className="mt-1 whitespace-pre-wrap break-words font-medium">{d.after}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <RejectReasonDialog
        open={!!rejectId}
        onOpenChange={(open) => {
          if (!open) setRejectId(null);
        }}
        title="Reject proposed changes"
        busy={review.isPending}
        onConfirm={(reason) => {
          if (!rejectId) return;
          review.mutate({ revisionId: rejectId, decision: "reject", reason });
        }}
      />
    </div>
  );
}
