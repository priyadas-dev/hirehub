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
      { title: "Edit job ΓÇö HireHub" },
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
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "id,title,description,location,salary_range,job_type,status,company_id,application_deadline,companies(name)",
        )
        .eq("id", jobId)
        .eq("recruiter_id", id!)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Job not found");
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
      if (!id) throw new Error("Not signed in");
      if (job.data?.status === "closed") {
        throw new Error("Closed jobs cannot be edited. Post a new listing instead.");
      }

      const previousDeadline = resolveJobDeadline(job.data?.application_deadline, job.data?.description);
      if (!canSetApplicationDeadline(values.application_deadline, previousDeadline)) {
        throw new Error("Deadline must be today or a future date (or leave the current expired deadline unchanged).");
      }

      const deadlineExtended =
        previousDeadline !== values.application_deadline &&
        isApplicationDeadlinePassed(previousDeadline) &&
        !isApplicationDeadlinePassed(values.application_deadline);

      // Ownership: recruiter_id filter; status is never written here (no re-approval).
      const { data, error } = await supabase
        .from("jobs")
        .update({
          title: values.title.trim(),
          description: stripDeadlineMarker(values.description).trim() || null,
          location: values.location.trim(),
          salary_range: values.salary_range?.trim() || null,
          job_type: values.job_type as JobType,
          application_deadline: values.application_deadline,
        })
        .eq("id", jobId)
        .eq("recruiter_id", id)
        .neq("status", "closed")
        .select("id,status,application_deadline");
      if (error) throw error;
      if (!data?.length) throw new Error("Job could not be updated. It may already be closed or not owned by you.");
      return { deadlineExtended, row: data[0] };
    },
    onSuccess: async (result) => {
      toast.success(result.deadlineExtended ? "Deadline extended ΓÇö applications can reopen" : "Job updated");
      await qc.invalidateQueries({ queryKey: ["recruiter-jobs"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-job", jobId] });
      await qc.invalidateQueries({ queryKey: ["rec-jobs"] });
      await qc.invalidateQueries({ queryKey: ["seeker-jobs"] });
      await qc.invalidateQueries({ queryKey: ["seeker-recommended"] });
      await qc.invalidateQueries({ queryKey: ["seeker-job", jobId] });
      void navigate({ to: "/recruiter/jobs" });
    },
    onError: (e: Error) => toast.error("Could not update job", { description: e.message }),
  });

  if (job.isLoading) return <CardSkeleton rows={6} />;
  if (job.isError) return <ErrorState onRetry={() => void job.refetch()} />;

  const closed = job.data?.status === "closed";
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
          closed
            ? "This listing is closed and can no longer be edited."
            : `${job.data?.companies?.name ?? "Company"} ┬╖ ${JOB_STATUS_LABEL[status]}${
                deadlineLabel ? ` ┬╖ Deadline ${deadlineLabel}${deadlineExpired ? " (expired)" : ""}` : ""
              }`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/recruiter/jobs">Back to jobs</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/recruiter/applicants" search={{ jobId }}>
                View applicants
              </Link>
            </Button>
          </div>
        }
      />

      {deadlineExpired && !closed && (
        <div className="rounded-xl border border-status-interview/30 bg-status-interview-soft/40 px-4 py-3 text-sm">
          The application deadline has expired. Set a new date of today or later to reopen applications. Extending the
          deadline does not change approval status or existing applications.
        </div>
      )}

      <form
        className="surface-card max-w-xl space-y-5 p-5 sm:p-6"
        onSubmit={form.handleSubmit((v) => save.mutate(v))}
      >
        <div className="space-y-2">
          <Label htmlFor="title">Job title</Label>
          <Input id="title" disabled={closed} {...form.register("title")} placeholder="Senior Engineer" />
          {form.formState.errors.title && (
            <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            rows={5}
            disabled={closed}
            {...form.register("description")}
            placeholder="Role detailsΓÇª"
          />
          {form.formState.errors.description && (
            <p className="text-xs text-destructive">{form.formState.errors.description.message}</p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Input id="location" disabled={closed} {...form.register("location")} placeholder="Remote / City" />
            {form.formState.errors.location && (
              <p className="text-xs text-destructive">{form.formState.errors.location.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="salary_range">Salary range</Label>
            <Input
              id="salary_range"
              disabled={closed}
              {...form.register("salary_range")}
              placeholder="e.g. $80kΓÇô$100k"
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Job type</Label>
            <Select
              value={form.watch("job_type")}
              disabled={closed}
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
              disabled={closed}
              disablePast
              placeholder={deadlineExpired ? "Extend deadlineΓÇª" : "Pick a deadline"}
              onChange={(iso) => form.setValue("application_deadline", iso, { shouldValidate: true })}
            />
            {deadlineLabel && (
              <p className="text-xs text-muted-foreground">
                Current: {deadlineLabel}
                {deadlineExpired ? " ┬╖ Expired ΓÇö extend to reopen applications" : " ┬╖ Open through end of day (Asia/Dhaka)"}
              </p>
            )}
            {form.formState.errors.application_deadline && (
              <p className="text-xs text-destructive">{form.formState.errors.application_deadline.message}</p>
            )}
          </div>
        </div>
        {!closed && (
          <Button type="submit" variant="signal" disabled={save.isPending}>
            {save.isPending ? "SavingΓÇª" : deadlineExpired ? "Extend deadline & save" : "Save changes"}
          </Button>
        )}
      </form>
    </div>
  );
}
