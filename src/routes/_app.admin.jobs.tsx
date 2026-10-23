import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { RejectReasonDialog } from "@/components/admin/RejectReasonDialog";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { JOB_TYPE_LABEL } from "@/lib/hirehub";
import { useAuth } from "@/lib/auth";
import {
  adminReopenPayload,
  isClosedReasonMissingError,
  manualClosePayload,
} from "@/lib/job-expiry-reopen";
import { adminReviewJob } from "@/lib/review-api";
import { fmtDate, supabase } from "@/components/dashboard/parts";

const searchSchema = z.object({
  q: z.string().optional(),
});

export const Route = createFileRoute("/_app/admin/jobs")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Approve jobs — HireHub" },
      { name: "description", content: "Review, approve, or reject pending job listings." },
    ],
  }),
  component: AdminJobsPage,
});

function AdminJobsPage() {
  const { user } = useAuth();
  const id = user?.id;
  const qc = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const q = search.q?.trim().toLowerCase() ?? "";
  const [rejectId, setRejectId] = useState<string | null>(null);

  const jobs = useQuery({
    queryKey: ["admin-jobs", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,title,location,job_type,status,rejection_reason,created_at,companies(name)")
        .order("created_at", { ascending: false });
      if (error) {
        // Pre-migration: rejection_reason column may be missing.
        const fallback = await supabase
          .from("jobs")
          .select("id,title,location,job_type,status,created_at,companies(name)")
          .order("created_at", { ascending: false });
        if (fallback.error) throw fallback.error;
        return (fallback.data ?? []).map((j) => ({
          ...j,
          rejection_reason: null as string | null,
        }));
      }
      return data;
    },
  });

  const review = useMutation({
    mutationFn: (input: { jobId: string; decision: "approve" | "reject"; reason?: string }) =>
      adminReviewJob(input),
    onSuccess: async (_, vars) => {
      toast.success(vars.decision === "approve" ? "Job approved" : "Job rejected");
      setRejectId(null);
      await invalidateJobQueries(qc);
    },
    onError: (e: Error) => toast.error("Could not review job", { description: e.message }),
  });

  const closeJob = useMutation({
    mutationFn: async (jobId: string) => {
      const withReason = manualClosePayload("admin");
      let result = await supabase
        .from("jobs")
        .update(withReason as never)
        .eq("id", jobId);
      if (result.error && isClosedReasonMissingError(result.error)) {
        result = await supabase.from("jobs").update({ status: "closed" }).eq("id", jobId);
      }
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      toast.success("Job closed");
      await invalidateJobQueries(qc);
    },
    onError: (e: Error) => toast.error("Could not close job", { description: e.message }),
  });

  const reopenJob = useMutation({
    mutationFn: async (jobId: string) => {
      const payload = adminReopenPayload();
      let result = await supabase
        .from("jobs")
        .update(payload as never)
        .eq("id", jobId);
      if (result.error && isClosedReasonMissingError(result.error)) {
        result = await supabase.from("jobs").update({ status: "approved" }).eq("id", jobId);
      }
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      toast.success("Job re-opened");
      await invalidateJobQueries(qc);
    },
    onError: (e: Error) => toast.error("Could not re-open job", { description: e.message }),
  });

  const filtered = useMemo(() => {
    const list = jobs.data ?? [];
    if (!q) return list;
    return list.filter((j) => {
      const hay = `${j.title} ${j.companies?.name ?? ""} ${j.location ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [jobs.data, q]);

  const pending = filtered.filter((j) => j.status === "pending");
  const others = filtered.filter((j) => j.status !== "pending");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Approve jobs"
        description="Approve or reject pending listings. Rejection requires a reason. Close approved roles that should leave the board."
      />

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by title, company, or location…"
          value={search.q ?? ""}
          onChange={(e) =>
            void navigate({
              search: (prev) => ({
                ...prev,
                q: e.target.value.trim() ? e.target.value : undefined,
              }),
              replace: true,
            })
          }
          autoComplete="off"
        />
      </div>

      {jobs.isLoading ? (
        <CardSkeleton rows={4} />
      ) : jobs.isError ? (
        <ErrorState onRetry={() => void jobs.refetch()} />
      ) : (
        <>
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">Pending approval ({pending.length})</h2>
            {pending.length ? (
              <ul className="surface-card divide-y">
                {pending.map((j) => (
                  <li
                    key={j.id}
                    className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{j.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {j.companies?.name ?? "Company"} · {j.location ?? "Remote"} ·{" "}
                        {JOB_TYPE_LABEL[j.job_type]} · {fmtDate(j.created_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="signal"
                        disabled={review.isPending}
                        onClick={() => review.mutate({ jobId: j.id, decision: "approve" })}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={review.isPending}
                        onClick={() => setRejectId(j.id)}
                      >
                        Reject
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={ShieldCheck}
                title={q ? "No pending jobs match" : "No pending jobs"}
                description={
                  q
                    ? "Try another search term or clear the header search."
                    : "All submitted roles are reviewed."
                }
              />
            )}
          </section>

          {others.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold">Reviewed jobs</h2>
              <ul className="surface-card divide-y">
                {others.map((j) => (
                  <li
                    key={j.id}
                    className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{j.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {j.companies?.name ?? "Company"} · {fmtDate(j.created_at)}
                      </p>
                      {j.status === "rejected" && j.rejection_reason && (
                        <p className="mt-1 text-xs text-destructive">
                          Reason: {j.rejection_reason}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border px-2.5 py-1 text-xs font-medium capitalize">
                        {j.status}
                      </span>
                      {j.status === "approved" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={closeJob.isPending}
                          onClick={() => closeJob.mutate(j.id)}
                        >
                          Close
                        </Button>
                      )}
                      {j.status === "closed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={reopenJob.isPending}
                          onClick={() => reopenJob.mutate(j.id)}
                        >
                          Re-open
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <RejectReasonDialog
        open={!!rejectId}
        onOpenChange={(open) => {
          if (!open) setRejectId(null);
        }}
        title="Reject job"
        busy={review.isPending}
        onConfirm={(reason) => {
          if (!rejectId) return;
          review.mutate({ jobId: rejectId, decision: "reject", reason });
        }}
      />
    </div>
  );
}

async function invalidateJobQueries(qc: ReturnType<typeof useQueryClient>) {
  await qc.invalidateQueries({ queryKey: ["admin-jobs"] });
  await qc.invalidateQueries({ queryKey: ["admin-attention"] });
  await qc.invalidateQueries({ queryKey: ["dash-counts"] });
  await qc.invalidateQueries({ queryKey: ["seeker-jobs"] });
  await qc.invalidateQueries({ queryKey: ["seeker-recommended"] });
  await qc.invalidateQueries({ queryKey: ["recruiter-jobs"] });
  await qc.invalidateQueries({ queryKey: ["rec-jobs"] });
  await qc.invalidateQueries({ queryKey: ["admin-reports"] });
  await qc.invalidateQueries({ queryKey: ["notifications"] });
}
