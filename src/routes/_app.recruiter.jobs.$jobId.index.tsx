import { useState, type ReactNode } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { CardSkeleton, ErrorState, PageHeader } from "@/components/feedback/States";
import { DeadlineDatePicker } from "@/components/jobs/DeadlineDatePicker";
import { fmtPostedDate } from "@/components/jobs/RecruiterJobMeta";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { JOB_TYPE_LABEL } from "@/lib/hirehub";
import {
  fmtDeadline,
  isApplicationDeadlinePassed,
  JOB_STATUS_BADGE_CLASS,
  JOB_STATUS_LABEL,
  resolveJobDeadline,
  stripDeadlineMarker,
  type JobStatus,
} from "@/lib/job-fields";
import {
  canDeleteJobWithApplications,
  countApplicationsForJob,
  deleteOwnJob,
} from "@/lib/job-delete";
import { recruiterReopenExpiredJob } from "@/lib/job-expiry-reopen-api";
import { isExpiryAutoClosedJob } from "@/lib/job-expiry-reopen";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { supabase } from "@/components/dashboard/parts";

export const Route = createFileRoute("/_app/recruiter/jobs/$jobId/")({
  head: () => ({
    meta: [
      { title: "Job details — HireHub" },
      { name: "description", content: "View and manage one of your job listings." },
    ],
  }),
  component: RecruiterJobDetailsPage,
});

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm leading-relaxed text-foreground">{children}</dd>
    </div>
  );
}

function RecruiterJobDetailsPage() {
  const { jobId } = Route.useParams();
  const { user } = useAuth();
  const id = user?.id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [deleteBlockedReason, setDeleteBlockedReason] = useState<string | null>(null);
  const [reopenDeadline, setReopenDeadline] = useState("");

  const job = useQuery({
    queryKey: ["recruiter-job-details", jobId, id],
    enabled: !!id && !!jobId,
    queryFn: async () => {
      // closed_reason is additive (PROPOSED_0014); cast select until types regenerate.
      const withReason = await supabase
        .from("jobs")
        .select(
          "id,title,description,location,salary_range,job_type,status,created_at,application_deadline,rejection_reason,closed_reason,companies(id,name,industry,website,status),applications(count)" as never,
        )
        .eq("id", jobId)
        .eq("recruiter_id", id!)
        .maybeSingle();
      if (!withReason.error && withReason.data) {
        return withReason.data as typeof withReason.data & { closed_reason?: string | null };
      }
      const primary = await supabase
        .from("jobs")
        .select(
          "id,title,description,location,salary_range,job_type,status,created_at,application_deadline,rejection_reason,companies(id,name,industry,website,status),applications(count)",
        )
        .eq("id", jobId)
        .eq("recruiter_id", id!)
        .maybeSingle();
      if (primary.error) {
        const fallback = await supabase
          .from("jobs")
          .select(
            "id,title,description,location,salary_range,job_type,status,created_at,application_deadline,companies(id,name,industry,website,status),applications(count)",
          )
          .eq("id", jobId)
          .eq("recruiter_id", id!)
          .maybeSingle();
        if (fallback.error) throw fallback.error;
        if (!fallback.data) throw new Error("Job not found");
        return {
          ...fallback.data,
          rejection_reason: null as string | null,
          closed_reason: null as string | null,
        };
      }
      if (!primary.data) throw new Error("Job not found");
      return { ...primary.data, closed_reason: null as string | null };
    },
  });

  const reopenExpired = useMutation({
    mutationFn: async () => {
      if (!id || !job.data) throw new Error("Not signed in");
      return recruiterReopenExpiredJob({
        job: {
          id: job.data.id,
          status: job.data.status,
          recruiter_id: id,
          closed_reason: (job.data as { closed_reason?: string | null }).closed_reason ?? null,
          application_deadline: job.data.application_deadline,
        },
        callerId: id,
        newDeadline: reopenDeadline,
      });
    },
    onSuccess: async () => {
      toast.success("Deadline extended — job reopened");
      setReopenDeadline("");
      await qc.invalidateQueries({ queryKey: ["recruiter-job-details", jobId] });
      await qc.invalidateQueries({ queryKey: ["recruiter-jobs"] });
      await qc.invalidateQueries({ queryKey: ["seeker-jobs"] });
      await qc.invalidateQueries({ queryKey: ["admin-jobs"] });
      await qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: Error) => toast.error("Could not reopen job", { description: e.message }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("Not signed in");
      const appCount = await countApplicationsForJob(jobId);
      const gate = canDeleteJobWithApplications(appCount);
      if (!gate.ok) {
        setDeleteBlockedReason(gate.reason);
        throw new Error(gate.reason);
      }
      setDeleteBlockedReason(null);
      return deleteOwnJob(jobId, id);
    },
    onSuccess: async () => {
      toast.success("Job deleted");
      await qc.invalidateQueries({ queryKey: ["recruiter-jobs"] });
      await qc.invalidateQueries({ queryKey: ["rec-jobs"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
      await qc.invalidateQueries({ queryKey: ["admin-jobs"] });
      await qc.invalidateQueries({ queryKey: ["seeker-jobs"] });
      void navigate({ to: "/recruiter/jobs" });
    },
    onError: (e: Error) => {
      // Application-block reason is shown inside the dialog; still toast other failures.
      if (!/has \d+ application/i.test(e.message)) {
        toast.error("Could not delete job", { description: e.message });
      }
    },
  });

  if (job.isLoading) return <CardSkeleton rows={8} />;
  if (job.isError) return <ErrorState onRetry={() => void job.refetch()} />;

  const j = job.data!;
  const status = j.status as JobStatus;
  const appCount = Array.isArray(j.applications) ? (j.applications[0]?.count ?? 0) : 0;
  const description = stripDeadlineMarker(j.description).trim();
  const deadline = resolveJobDeadline(j.application_deadline, j.description);
  const deadlineLabel = fmtDeadline(deadline);
  const deadlineExpired = isApplicationDeadlinePassed(deadline);
  const canEdit = status !== "closed" && status !== "rejected";
  const closedReason = (j as { closed_reason?: string | null }).closed_reason ?? null;
  const canExtendReopen = isExpiryAutoClosedJob({ status, closed_reason: closedReason });
  const company = j.companies;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Recruiter"
        title={j.title}
        description="Full details for this listing. Edit opens the existing form; approved jobs still go through admin revision review."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/recruiter/jobs">
                <ArrowLeft /> Back to job posts
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/recruiter/applicants" search={{ jobId }}>
                <Users /> Applicants ({appCount})
              </Link>
            </Button>
            {canEdit && (
              <Button variant="signal" size="sm" asChild onClick={(e) => e.stopPropagation()}>
                <Link to="/recruiter/jobs/$jobId/edit" params={{ jobId }}>
                  <Pencil /> Edit
                </Link>
              </Button>
            )}
            <AlertDialog
              onOpenChange={(open) => {
                if (!open) setDeleteBlockedReason(null);
              }}
            >
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Trash2 /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this job?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p>
                        This permanently removes{" "}
                        <span className="font-medium text-foreground">{j.title}</span> if it has no
                        applications.
                      </p>
                      <p>
                        If candidates have already applied, deletion is blocked so application
                        records are not removed. Use Close on the job list instead in that case.
                      </p>
                      {deleteBlockedReason && (
                        <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-destructive">
                          {deleteBlockedReason}
                        </p>
                      )}
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  {!deleteBlockedReason && (
                    <AlertDialogAction
                      disabled={remove.isPending}
                      onClick={(e) => {
                        e.preventDefault();
                        remove.mutate();
                      }}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {remove.isPending ? "Deleting…" : "Delete job"}
                    </AlertDialogAction>
                  )}
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs font-medium",
            JOB_STATUS_BADGE_CLASS[status],
          )}
        >
          {JOB_STATUS_LABEL[status]}
        </span>
        {deadlineExpired && (
          <span className="rounded-full border border-status-interview/40 bg-status-interview-soft/60 px-2.5 py-1 text-xs font-medium text-status-interview">
            Deadline expired
          </span>
        )}
      </div>

      {status === "rejected" && j.rejection_reason && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-medium text-destructive">Rejected by admin</p>
          <p className="mt-1 text-muted-foreground">{j.rejection_reason}</p>
        </div>
      )}

      {status === "approved" && (
        <p className="text-sm text-muted-foreground">
          Editing this approved job submits a proposed revision for admin review. The live listing
          stays unchanged until approved.
        </p>
      )}

      {status === "closed" && canExtendReopen && (
        <section className="surface-card space-y-4 p-5 sm:p-6">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold tracking-tight">Extend deadline &amp; reopen</h2>
            <p className="text-sm text-muted-foreground">
              This listing was closed automatically when its application deadline passed. Choose a
              new deadline (today or later) and confirm reopen. Changing the date alone does not
              reopen the job.
            </p>
          </div>
          <div className="max-w-sm space-y-2">
            <Label htmlFor="reopen_deadline">New application deadline</Label>
            <DeadlineDatePicker
              id="reopen_deadline"
              value={reopenDeadline}
              onChange={setReopenDeadline}
            />
          </div>
          <Button
            type="button"
            variant="signal"
            disabled={!reopenDeadline || reopenExpired.isPending}
            onClick={() => reopenExpired.mutate()}
          >
            {reopenExpired.isPending ? "Reopening…" : "Extend deadline & reopen job"}
          </Button>
        </section>
      )}

      {status === "closed" && !canExtendReopen && (
        <div className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
          This listing is closed
          {closedReason === "recruiter" || closedReason === "admin"
            ? " manually"
            : closedReason
              ? ""
              : " (close reason unknown)"}
          . Recruiters can only reopen jobs that were auto-closed for an expired deadline. Ask an
          admin if you need this listing live again.
        </div>
      )}

      <dl className="surface-card grid gap-6 p-5 sm:grid-cols-2 sm:p-6">
        <Field label="Company">
          {company?.name ?? "Not provided"}
          {company?.industry ? (
            <span className="mt-1 block text-xs text-muted-foreground">{company.industry}</span>
          ) : null}
          {company?.website ? (
            <a
              href={company.website}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block break-all text-xs text-signal underline-offset-4 hover:underline"
            >
              {company.website}
            </a>
          ) : null}
        </Field>
        <Field label="Location">{j.location?.trim() || "Not provided"}</Field>
        <Field label="Job type">{JOB_TYPE_LABEL[j.job_type]}</Field>
        <Field label="Salary range">{j.salary_range?.trim() || "Not provided"}</Field>
        <Field label="Posted">{fmtPostedDate(j.created_at)}</Field>
        <Field label="Application deadline">
          {deadlineLabel
            ? deadlineExpired
              ? `${deadlineLabel} (expired)`
              : deadlineLabel
            : "Not provided"}
        </Field>
        <Field label="Applicants">
          {appCount} applicant{appCount === 1 ? "" : "s"}
        </Field>
        <Field label="Status">{JOB_STATUS_LABEL[status]}</Field>
      </dl>

      <section className="surface-card space-y-3 p-5 sm:p-6">
        <h2 className="text-sm font-semibold tracking-tight">Description</h2>
        {description ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {description}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Not provided</p>
        )}
      </section>
    </div>
  );
}
