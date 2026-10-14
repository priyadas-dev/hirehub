import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CardSkeleton, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DeadlineDatePicker } from "@/components/jobs/DeadlineDatePicker";
import { JOB_TYPE_LABEL, type JobType } from "@/lib/hirehub";
import {
  canSetApplicationDeadline,
  fmtDeadline,
  isApplicationDeadlinePassed,
  JOB_STATUS_LABEL,
  resolveJobDeadline,
  stripDeadlineMarker,
  type JobStatus,
} from "@/lib/job-fields";
import {
  canDirectEditLiveJob,
  canSubmitJobRevision,
  jobContentChanged,
} from "@/lib/job-revisions";
import { submitJobRevision, isReviewSchemaUnavailable } from "@/lib/review-api";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/components/dashboard/parts";

const schema = z.object({
  title: z.string().trim().min(2, "Title is required"),
  description: z.string().trim().min(1, "Description is required"),
  location: z.string().trim().min(1, "Location is required"),
  salary_range: z.string().trim().optional(),
  job_type: z.enum(["full_time", "part_time", "contract"]),
  application_deadline: z.string().min(1, "Application deadline is required"),
});

type FormValues = z.infer<typeof schema>;

export const Route = createFileRoute("/_app/recruiter/jobs/$jobId/edit")({
  head: () => ({
    meta: [
      { title: "Edit job — HireHub" },
      { name: "description", content: "Update your job listing details." },
    ],
  }),
  component: EditJobPage,
});

function EditJobPage() {
  const { jobId } = Route.useParams();
  const { user } = useAuth();
  const id = user?.id;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const job = useQuery({
    queryKey: ["recruiter-job", jobId, id],
    enabled: !!id && !!jobId,
    queryFn: async () => {
      const primary = await supabase
        .from("jobs")
        .select(
          "id,title,description,location,salary_range,job_type,status,company_id,application_deadline,rejection_reason,companies(name)",
        )
        .eq("id", jobId)
        .eq("recruiter_id", id!)
        .maybeSingle();
      if (primary.error) {
        const fallback = await supabase
          .from("jobs")
          .select(
            "id,title,description,location,salary_range,job_type,status,company_id,application_deadline,companies(name)",
          )
          .eq("id", jobId)
          .eq("recruiter_id", id!)
          .maybeSingle();
        if (fallback.error) throw fallback.error;
        if (!fallback.data) throw new Error("Job not found");
        return { ...fallback.data, rejection_reason: null as string | null };
      }
      if (!primary.data) throw new Error("Job not found");
      return primary.data;
    },
  });

  const pendingRevision = useQuery({
    queryKey: ["recruiter-job-pending-revision", jobId, id],
    enabled: !!id && !!jobId && job.data?.status === "approved",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_revisions")
        .select("id,status,created_at,rejection_reason")
        .eq("job_id", jobId)
        .eq("status", "pending")
        .maybeSingle();
      if (error) {
        if (isReviewSchemaUnavailable(error)) return null;
        throw error;
      }
      return data;
    },
  });

  const latestRejectedRevision = useQuery({
    queryKey: ["recruiter-job-rejected-revision", jobId, id],
    enabled: !!id && !!jobId && job.data?.status === "approved" && !pendingRevision.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_revisions")
        .select("id,status,created_at,rejection_reason")
        .eq("job_id", jobId)
        .eq("status", "rejected")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        if (isReviewSchemaUnavailable(error)) return null;
        throw error;
      }
      return data;
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      description: "",
      location: "",
      salary_range: "",
      job_type: "full_time",
      application_deadline: "",
    },
  });

  useEffect(() => {
    if (job.data) {
      const deadline = resolveJobDeadline(job.data.application_deadline, job.data.description);
      form.reset({
        title: job.data.title,
        description: stripDeadlineMarker(job.data.description),
        location: job.data.location ?? "",
        salary_range: job.data.salary_range ?? "",
        job_type: job.data.job_type,
        application_deadline: deadline ?? "",
      });
    }
  }, [job.data, form]);

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!id || !job.data) throw new Error("Not signed in");
      if (job.data.status === "closed" || job.data.status === "rejected") {
        throw new Error("This listing cannot be edited.");
      }

      const previousDeadline = resolveJobDeadline(job.data.application_deadline, job.data.description);
      if (!canSetApplicationDeadline(values.application_deadline, previousDeadline)) {
        throw new Error("Deadline must be today or a future date (or leave the current expired deadline unchanged).");
      }

      const proposed = {
        title: values.title.trim(),
        description: stripDeadlineMarker(values.description).trim() || null,
        location: values.location.trim(),
        salary_range: values.salary_range?.trim() || null,
        job_type: values.job_type as JobType,
        application_deadline: values.application_deadline,
      };

      // Approved jobs: submit revision — live row stays unchanged until admin approves.
      if (job.data.status === "approved") {
        const gate = canSubmitJobRevision({
          jobStatus: job.data.status,
          hasPendingRevision: !!pendingRevision.data,
          isOwner: true,
        });
        if (!gate.ok) throw new Error(gate.reason);

        const live = {
          title: job.data.title,
          description: stripDeadlineMarker(job.data.description) || null,
          location: job.data.location,
          salary_range: job.data.salary_range,
          job_type: job.data.job_type,
          application_deadline: previousDeadline,
        };
        if (!jobContentChanged(live, proposed)) {
          throw new Error("No changes to submit.");
        }

        await submitJobRevision({
          jobId,
          title: proposed.title,
          description: proposed.description,
          location: proposed.location,
          job_type: proposed.job_type,
          salary_range: proposed.salary_range,
          application_deadline: proposed.application_deadline,
        });
        return { mode: "revision" as const };
      }

      if (!canDirectEditLiveJob(job.data.status)) {
        throw new Error("This job cannot be edited directly.");
      }

      const { data, error } = await supabase
        .from("jobs")
        .update({
          title: proposed.title,
          description: proposed.description,
          location: proposed.location,
          salary_range: proposed.salary_range,
          job_type: proposed.job_type,
          application_deadline: proposed.application_deadline,
        })
        .eq("id", jobId)
        .eq("recruiter_id", id)
        .eq("status", "pending")
        .select("id,status,application_deadline");
      if (error) throw error;
      if (!data?.length) throw new Error("Job could not be updated.");
      return { mode: "direct" as const };
    },
    onSuccess: async (result) => {
      if (result.mode === "revision") {
        toast.success("Changes submitted for admin review", {
          description: "Your live listing stays unchanged until an admin approves.",
        });
      } else {
        toast.success("Job updated");
      }
      await qc.invalidateQueries({ queryKey: ["recruiter-jobs"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-job", jobId] });
      await qc.invalidateQueries({ queryKey: ["recruiter-job-pending-revision", jobId] });
      await qc.invalidateQueries({ queryKey: ["admin-job-revisions"] });
      await qc.invalidateQueries({ queryKey: ["notifications"] });
      void navigate({ to: "/recruiter/jobs" });
    },
    onError: (e: Error) => toast.error("Could not save job", { description: e.message }),
  });

  if (job.isLoading) return <CardSkeleton rows={6} />;
  if (job.isError) return <ErrorState onRetry={() => void job.refetch()} />;

  const closed = job.data?.status === "closed";
  const rejected = job.data?.status === "rejected";
  const approved = job.data?.status === "approved";
  const locked = closed || rejected || !!pendingRevision.data;
  const status = (job.data?.status ?? "pending") as JobStatus;
  const currentDeadline = resolveJobDeadline(job.data?.application_deadline, job.data?.description);
  const deadlineExpired = isApplicationDeadlinePassed(currentDeadline);
  const deadlineLabel = fmtDeadline(currentDeadline);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Recruiter"
        title="Edit job"
        description={
          closed || rejected
            ? `This listing is ${status} and can no longer be edited.`
            : `${job.data?.companies?.name ?? "Company"} · ${JOB_STATUS_LABEL[status]}${
                deadlineLabel ? ` · Deadline ${deadlineLabel}${deadlineExpired ? " (expired)" : ""}` : ""
              }`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/recruiter/jobs/$jobId" params={{ jobId }}>
                Back to details
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/recruiter/jobs">All job posts</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/recruiter/applicants" search={{ jobId }}>
                View applicants
              </Link>
            </Button>
          </div>
        }
      />

      {rejected && job.data?.rejection_reason && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-medium text-destructive">This job was rejected</p>
          <p className="mt-1 text-muted-foreground">{job.data.rejection_reason}</p>
        </div>
      )}

      {approved && pendingRevision.data && (
        <div className="rounded-xl border border-status-interview/30 bg-status-interview-soft/40 px-4 py-3 text-sm">
          Proposed edits are pending admin review. The live approved listing is unchanged for job seekers until an admin
          decides.
        </div>
      )}

      {approved && !pendingRevision.data && latestRejectedRevision.data?.rejection_reason && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-medium text-destructive">Latest revision was rejected</p>
          <p className="mt-1 text-muted-foreground">{latestRejectedRevision.data.rejection_reason}</p>
          <p className="mt-1 text-xs text-muted-foreground">Your live approved listing was not changed. You can submit a new revision.</p>
        </div>
      )}

      {approved && !pendingRevision.data && (
        <div className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
          Saving submits proposed changes for admin approval. Job seekers continue to see the current approved version
          until then.
        </div>
      )}

      {deadlineExpired && !locked && (
        <div className="rounded-xl border border-status-interview/30 bg-status-interview-soft/40 px-4 py-3 text-sm">
          The application deadline has expired. Set a new date of today or later to reopen applications.
        </div>
      )}

      <form
        className="surface-card max-w-xl space-y-5 p-5 sm:p-6"
        onSubmit={form.handleSubmit((v) => save.mutate(v))}
      >
        <div className="space-y-2">
          <Label htmlFor="title">Job title</Label>
          <Input id="title" disabled={locked} {...form.register("title")} placeholder="Senior Engineer" />
          {form.formState.errors.title && (
            <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            rows={5}
            disabled={locked}
            {...form.register("description")}
            placeholder="Describe the responsibilities, required skills, qualifications, and experience for this role…"
          />
          {form.formState.errors.description && (
            <p className="text-xs text-destructive">{form.formState.errors.description.message}</p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Input id="location" disabled={locked} {...form.register("location")} placeholder="Remote / City" />
            {form.formState.errors.location && (
              <p className="text-xs text-destructive">{form.formState.errors.location.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="salary_range">Salary range</Label>
            <Input
              id="salary_range"
              disabled={locked}
              {...form.register("salary_range")}
              placeholder="e.g. ৳40,000–৳60,000/month"
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Job type</Label>
            <Select
              value={form.watch("job_type")}
              disabled={locked}
              onValueChange={(v) => form.setValue("job_type", v as JobType, { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(JOB_TYPE_LABEL) as JobType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {JOB_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="application_deadline">Application deadline</Label>
            <DeadlineDatePicker
              id="application_deadline"
              value={form.watch("application_deadline")}
              disabled={locked}
              disablePast
              placeholder={deadlineExpired ? "Extend deadline…" : "Pick a deadline"}
              onChange={(iso) => form.setValue("application_deadline", iso, { shouldValidate: true })}
            />
            {form.formState.errors.application_deadline && (
              <p className="text-xs text-destructive">{form.formState.errors.application_deadline.message}</p>
            )}
          </div>
        </div>
        {!locked && (
          <Button type="submit" variant="signal" disabled={save.isPending}>
            {save.isPending
              ? "Saving…"
              : approved
                ? "Submit for admin review"
                : deadlineExpired
                  ? "Extend deadline & save"
                  : "Save changes"}
          </Button>
        )}
      </form>
    </div>
  );
}
