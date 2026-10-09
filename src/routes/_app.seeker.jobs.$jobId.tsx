import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Briefcase, Building2, Calendar, MapPin } from "lucide-react";
import { toast } from "sonner";
import { CardSkeleton, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { JOB_TYPE_LABEL } from "@/lib/hirehub";
import {
  fmtDeadline,
  isApplicationDeadlinePassed,
  unpackJobDescription,
} from "@/lib/job-fields";
import { useAuth } from "@/lib/auth";
import { fmtDate, supabase } from "@/components/dashboard/parts";

const applySchema = z.object({
  resume_url: z
    .string()
    .trim()
    .min(1, "Resume URL is required")
    .refine((v) => /^https?:\/\/\S+/i.test(v), "Resume must be a full URL starting with http:// or https://"),
  cover_note: z.string().trim().optional(),
});

type ApplyValues = z.infer<typeof applySchema>;

export const Route = createFileRoute("/_app/seeker/jobs/$jobId")({
  head: () => ({
    meta: [{ title: "Job details — HireHub" }],
  }),
  component: JobDetailPage,
});

function JobDetailPage() {
  const { jobId } = Route.useParams();
  const { user } = useAuth();
  const id = user?.id;
  const qc = useQueryClient();
  const navigate = useNavigate();

  const job = useQuery({
    queryKey: ["seeker-job", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,title,description,location,salary_range,job_type,status,created_at,companies(name,industry)")
        .eq("id", jobId)
        .eq("status", "approved")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const existingApp = useQuery({
    queryKey: ["seeker-app-for-job", id, jobId],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id,status")
        .eq("seeker_id", id!)
        .eq("job_id", jobId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const saved = useQuery({
    queryKey: ["seeker-saved-for-job", id, jobId],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_jobs")
        .select("id")
        .eq("seeker_id", id!)
        .eq("job_id", jobId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const toggleSave = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("Not signed in");
      if (saved.data?.id) {
        const { error } = await supabase.from("saved_jobs").delete().eq("id", saved.data.id).eq("seeker_id", id);
        if (error) throw error;
        return "removed" as const;
      }
      const { error } = await supabase.from("saved_jobs").insert({ seeker_id: id, job_id: jobId });
      if (error) throw error;
      return "saved" as const;
    },
    onSuccess: async (action) => {
      toast.success(action === "saved" ? "Job saved" : "Removed from saved");
      await qc.invalidateQueries({ queryKey: ["seeker-saved-for-job", id, jobId] });
      await qc.invalidateQueries({ queryKey: ["seeker-saved"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
    },
    onError: (e: Error) => toast.error("Could not update saved jobs", { description: e.message }),
  });

  const latestResume = useQuery({
    queryKey: ["seeker-latest-resume", id],
    enabled: !!id,
    queryFn: async () => {
      const [{ data: authData }, appRes] = await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from("applications")
          .select("resume_url")
          .eq("seeker_id", id!)
          .not("resume_url", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (appRes.error) throw appRes.error;
      const meta = (authData.user?.user_metadata ?? {}) as Record<string, unknown>;
      const metaResume = typeof meta.resume_url === "string" ? meta.resume_url.trim() : "";
      return { resume_url: metaResume || appRes.data?.resume_url || null };
    },
  });

  const form = useForm<ApplyValues>({
    resolver: zodResolver(applySchema),
    defaultValues: { resume_url: "", cover_note: "" },
  });

  useEffect(() => {
    if (latestResume.data?.resume_url && !form.getValues("resume_url")) {
      form.setValue("resume_url", latestResume.data.resume_url, { shouldValidate: false });
    }
  }, [latestResume.data, form]);

  const apply = useMutation({
    mutationFn: async (values: ApplyValues) => {
      if (!id) throw new Error("Not signed in");

      const deadline = unpackJobDescription(job.data?.description).applicationDeadline;
      if (isApplicationDeadlinePassed(deadline)) {
        throw new Error("The application deadline for this job has passed.");
      }

      const { data: existing, error: existingErr } = await supabase
        .from("applications")
        .select("id")
        .eq("seeker_id", id)
        .eq("job_id", jobId)
        .maybeSingle();
      if (existingErr) throw existingErr;
      if (existing) {
        const err = new Error("Already applied");
        (err as Error & { applicationId?: string }).applicationId = existing.id;
        throw err;
      }

      const { data, error } = await supabase
        .from("applications")
        .insert({
          job_id: jobId,
          seeker_id: id,
          resume_url: values.resume_url.trim(),
          cover_note: values.cover_note?.trim() || null,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
          throw new Error("Already applied");
        }
        throw error;
      }
      return data;
    },
    onSuccess: async (data) => {
      toast.success("Application submitted");
      await qc.invalidateQueries({ queryKey: ["seeker-app-for-job", id, jobId] });
      await qc.invalidateQueries({ queryKey: ["seeker-applications"] });
      await qc.invalidateQueries({ queryKey: ["seeker-recent"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-applicants"] });
      void navigate({ to: "/seeker/applications/$applicationId", params: { applicationId: data.id } });
    },
    onError: (e: Error & { applicationId?: string }) => {
      if (/already applied/i.test(e.message) || /duplicate|unique/i.test(e.message)) {
        toast.error("Already applied", {
          description: "You already applied to this role.",
          action: e.applicationId
            ? {
                label: "View",
                onClick: () => {
                  void navigate({
                    to: "/seeker/applications/$applicationId",
                    params: { applicationId: e.applicationId! },
                  });
                },
              }
            : undefined,
        });
        void qc.invalidateQueries({ queryKey: ["seeker-app-for-job", id, jobId] });
      } else {
        toast.error("Could not apply", { description: e.message });
      }
    },
  });

  if (job.isLoading) return <CardSkeleton rows={6} />;
  if (job.isError) return <ErrorState onRetry={() => void job.refetch()} />;
  if (!job.data) {
    return <ErrorState title="Job not found" description="This role is missing, closed, or not approved yet." />;
  }

  const j = job.data;
  const companyName = j.companies?.name ?? "Company";
  const { description: plainDescription, applicationDeadline } = unpackJobDescription(j.description);
  const deadlineLabel = fmtDeadline(applicationDeadline);
  const deadlinePassed = isApplicationDeadlinePassed(applicationDeadline);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={companyName}
        title={j.title}
        description={`${JOB_TYPE_LABEL[j.job_type]} · Posted ${fmtDate(j.created_at)}${
          deadlineLabel ? ` · Deadline ${deadlineLabel}` : ""
        }`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!id || toggleSave.isPending}
              onClick={() => toggleSave.mutate()}
            >
              <Bookmark className={saved.data ? "fill-current" : undefined} />
              {saved.data ? "Saved" : "Save job"}
            </Button>
            <Button variant="outline" asChild>
              <Link to="/seeker/saved">Saved</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/seeker/jobs">Back to jobs</Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-5 lg:gap-8">
        <section className="surface-card animate-fade-up space-y-5 p-5 sm:p-7 lg:col-span-3">
          <h2 className="text-lg font-semibold tracking-tight">About the role</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {plainDescription || "No description provided."}
          </p>
          <dl className="mt-2 grid gap-3 border-t pt-5 text-sm sm:grid-cols-2">
            <div className="flex gap-3 rounded-xl bg-surface/70 p-3 ring-1 ring-border/60">
              <Building2 className="mt-0.5 size-4 shrink-0 text-signal" />
              <div>
                <dt className="text-xs text-muted-foreground">Company</dt>
                <dd className="font-medium tracking-tight">{companyName}</dd>
              </div>
            </div>
            <div className="flex gap-3 rounded-xl bg-surface/70 p-3 ring-1 ring-border/60">
              <MapPin className="mt-0.5 size-4 shrink-0 text-signal" />
              <div>
                <dt className="text-xs text-muted-foreground">Location</dt>
                <dd className="font-medium tracking-tight">{j.location ?? "Remote"}</dd>
              </div>
            </div>
            <div className="flex gap-3 rounded-xl bg-surface/70 p-3 ring-1 ring-border/60">
              <Briefcase className="mt-0.5 size-4 shrink-0 text-signal" />
              <div>
                <dt className="text-xs text-muted-foreground">Job type</dt>
                <dd className="font-medium tracking-tight">{JOB_TYPE_LABEL[j.job_type]}</dd>
              </div>
            </div>
            <div className="flex gap-3 rounded-xl bg-surface/70 p-3 ring-1 ring-border/60">
              <Calendar className="mt-0.5 size-4 shrink-0 text-signal" />
              <div>
                <dt className="text-xs text-muted-foreground">Posted</dt>
                <dd className="font-medium tracking-tight">{fmtDate(j.created_at)}</dd>
              </div>
            </div>
            {deadlineLabel && (
              <div className="flex gap-3 rounded-xl bg-surface/70 p-3 ring-1 ring-border/60 sm:col-span-2">
                <Calendar className="mt-0.5 size-4 shrink-0 text-signal" />
                <div>
                  <dt className="text-xs text-muted-foreground">Application deadline</dt>
                  <dd className="font-medium tracking-tight">
                    {deadlineLabel}
                    {deadlinePassed ? " · Closed" : ""}
                  </dd>
                </div>
              </div>
            )}
          </dl>
        </section>

        <section className="surface-card animate-fade-up space-y-4 p-5 shadow-lift sm:p-7 lg:sticky lg:top-20 lg:col-span-2 lg:self-start [animation-delay:80ms]">
          <h2 className="text-lg font-semibold tracking-tight">Apply</h2>
          {existingApp.isLoading ? (
            <CardSkeleton rows={3} />
          ) : existingApp.data ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">You already applied to this role.</p>
              <Button asChild variant="signal">
                <Link to="/seeker/applications/$applicationId" params={{ applicationId: existingApp.data.id }}>
                  View application
                </Link>
              </Button>
            </div>
          ) : deadlinePassed ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Applications closed on {deadlineLabel}. This role is no longer accepting new applications.
              </p>
              <Button variant="outline" asChild>
                <Link to="/seeker/jobs">Browse other jobs</Link>
              </Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={form.handleSubmit((v) => apply.mutate(v))}>
              <div className="space-y-2">
                <Label htmlFor="resume_url">Resume URL</Label>
                <Input id="resume_url" placeholder="https://…" {...form.register("resume_url")} />
                {form.formState.errors.resume_url && (
                  <p className="text-xs text-destructive">{form.formState.errors.resume_url.message}</p>
                )}
                {latestResume.data?.resume_url ? (
                  <p className="text-xs text-muted-foreground">
                    Prefilled from your profile or last application — edit if needed.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Add a public resume link. You can also save a preferred URL on your{" "}
                    <Link to="/seeker/profile" className="text-signal underline">
                      profile
                    </Link>
                    .
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="cover_note">Cover note (optional)</Label>
                <Textarea id="cover_note" rows={4} placeholder="Optional note for the recruiter" {...form.register("cover_note")} />
              </div>
              {deadlineLabel && (
                <p className="text-xs text-muted-foreground">Apply by {deadlineLabel}.</p>
              )}
              <Button type="submit" variant="signal" className="w-full" disabled={apply.isPending}>
                {apply.isPending ? "Submitting…" : "Submit application"}
              </Button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
