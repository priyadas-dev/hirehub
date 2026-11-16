import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bookmark, Briefcase, Building2, Calendar, MapPin } from "lucide-react";
import { toast } from "sonner";
import {
  ResumePdfPicker,
  type ResumePickerValue,
} from "@/components/applications/ResumePdfPicker";
import { CompanyLogo } from "@/components/company/CompanyLogo";
import { CardSkeleton, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFileUploadsReady } from "@/hooks/use-file-uploads-ready";
import { JOB_TYPE_LABEL } from "@/lib/hirehub";
import { isMissingSchemaError, storageFirstFolder, storagePathIsSafe } from "@/lib/hirehub-storage";
import {
  fmtDeadline,
  isApplicationDeadlinePassed,
  resolveJobDeadline,
  stripDeadlineMarker,
} from "@/lib/job-fields";
import {
  PORTFOLIO_PERSISTENCE_NOTE,
  validatePortfolioUrl,
} from "@/lib/resume-upload";
import { applyToJob } from "@/lib/apply-to-job";
import { createSupabaseApplyToJobClient } from "@/lib/apply-to-job-supabase";
import { useAuth } from "@/lib/auth";
import { syncCrmContactFromApplication } from "@/lib/crm/sync-from-application.fn";
import { fmtDate, supabase } from "@/components/dashboard/parts";

const applySchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, "Enter your name (at least 2 characters)."),
  email: z
    .string()
    .trim()
    .email("Enter a valid email address."),
  cover_note: z
    .string()
    .trim()
    .min(10, "About you must be at least 10 characters."),
  resume_url: z.string().trim().optional(),
  portfolio_url: z
    .string()
    .trim()
    .optional()
    .superRefine((value, ctx) => {
      const result = validatePortfolioUrl(value ?? "");
      if (!result.ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error });
      }
    }),
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
  const syncCrmFromApplication = useServerFn(syncCrmContactFromApplication);
  const uploadsReady = useFileUploadsReady();
  const canPersist = !!uploadsReady.data;
  const [resumeValue, setResumeValue] = useState<ResumePickerValue | null>(null);

  const job = useQuery({
    queryKey: ["seeker-job", jobId],
    queryFn: async () => {
      const withLogo = await supabase
        .from("jobs")
        .select(
          "id,title,description,location,salary_range,job_type,status,created_at,application_deadline,companies(name,industry,logo_url)",
        )
        .eq("id", jobId)
        .eq("status", "approved")
        .maybeSingle();
      if (withLogo.error && isMissingSchemaError(withLogo.error.message)) {
        const fallback = await supabase
          .from("jobs")
          .select(
            "id,title,description,location,salary_range,job_type,status,created_at,application_deadline,companies(name,industry)",
          )
          .eq("id", jobId)
          .eq("status", "approved")
          .maybeSingle();
        if (fallback.error) throw fallback.error;
        return fallback.data
          ? {
              ...fallback.data,
              companies: fallback.data.companies
                ? { ...fallback.data.companies, logo_url: null as string | null }
                : null,
            }
          : null;
      }
      if (withLogo.error) throw withLogo.error;
      return withLogo.data;
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
      const profileRes = await supabase
        .from("profiles")
        .select("full_name,email,resume_storage_path,resume_file_name")
        .eq("id", id!)
        .maybeSingle();

      let profilePath: string | null = null;
      let profileFileName: string | null = null;
      let profileName: string | null = null;
      let profileEmail: string | null = null;
      if (profileRes.error && isMissingSchemaError(profileRes.error.message)) {
        /* columns not applied yet — retry identity-only */
        const identity = await supabase
          .from("profiles")
          .select("full_name,email")
          .eq("id", id!)
          .maybeSingle();
        if (identity.error) throw identity.error;
        profileName = identity.data?.full_name ?? null;
        profileEmail = identity.data?.email ?? null;
      } else if (profileRes.error) {
        throw profileRes.error;
      } else {
        profilePath = profileRes.data?.resume_storage_path ?? null;
        profileFileName = profileRes.data?.resume_file_name ?? null;
        profileName = profileRes.data?.full_name ?? null;
        profileEmail = profileRes.data?.email ?? null;
      }

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
      const metaResumeRaw = meta["resume_url"];
      const metaResume = typeof metaResumeRaw === "string" ? metaResumeRaw.trim() : "";
      const authEmail = authData.user?.email?.trim() || null;
      return {
        full_name: profileName,
        email: profileEmail || authEmail,
        resume_storage_path: profilePath,
        resume_file_name: profileFileName,
        resume_url: metaResume || appRes.data?.resume_url || null,
      };
    },
  });

  const form = useForm<ApplyValues>({
    resolver: zodResolver(applySchema),
    defaultValues: {
      full_name: "",
      email: "",
      cover_note: "",
      resume_url: "",
      portfolio_url: "",
    },
  });

  useEffect(() => {
    if (!latestResume.data) return;
    if (!form.getValues("full_name") && latestResume.data.full_name) {
      form.setValue("full_name", latestResume.data.full_name, { shouldValidate: false });
    }
    if (!form.getValues("email") && latestResume.data.email) {
      form.setValue("email", latestResume.data.email, { shouldValidate: false });
    }
    if (latestResume.data.resume_url && !form.getValues("resume_url")) {
      form.setValue("resume_url", latestResume.data.resume_url, { shouldValidate: false });
    }
    if (latestResume.data.resume_storage_path) {
      setResumeValue({
        storagePath: latestResume.data.resume_storage_path,
        fileName: latestResume.data.resume_file_name,
        isApplicationOverride: false,
      });
    }
  }, [latestResume.data, form]);

  const apply = useMutation({
    mutationFn: async (values: ApplyValues) => {
      if (!id) throw new Error("Not signed in");

      const portfolio = validatePortfolioUrl(values.portfolio_url ?? "");
      if (!portfolio.ok) throw new Error(portfolio.error);

      const storagePath =
        resumeValue?.storagePath || latestResume.data?.resume_storage_path || null;
      const fileName =
        resumeValue?.fileName || latestResume.data?.resume_file_name || null;

      const result = await applyToJob(createSupabaseApplyToJobClient(supabase), {
        jobId,
        seekerId: id,
        fullName: values.full_name,
        email: values.email,
        canPersistStorage: canPersist,
        resumeStoragePath: storagePath,
        resumeFileName: fileName,
        resumeUrl: values.resume_url?.trim() || null,
        portfolioUrl: portfolio.url,
        coverNote: values.cover_note,
        isDeadlinePassed: (job) => {
          const deadline = resolveJobDeadline(job.application_deadline, job.description);
          return isApplicationDeadlinePassed(deadline);
        },
        assertResumeStoragePath: (path, seekerId) => {
          if (!storagePathIsSafe(path) || storageFirstFolder(path) !== seekerId) {
            throw new Error("Resume Storage path must be {seeker_id}/{file}.");
          }
        },
      });

      if (!result.ok) throw new Error(result.message);

      if (result.status === "already_applied") {
        const err = new Error("Already applied");
        (err as Error & { applicationId?: string }).applicationId = result.applicationId;
        throw err;
      }

      return { id: result.applicationId };
    },
    onSuccess: async (data) => {
      toast.success("Application submitted");
      try {
        await syncCrmFromApplication({ data: { applicationId: data.id } });
      } catch {
        /* soft-fail CRM sync */
      }
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

  if (job.isLoading || uploadsReady.isLoading) return <CardSkeleton rows={6} />;
  if (job.isError) return <ErrorState onRetry={() => void job.refetch()} />;
  if (!job.data) {
    return <ErrorState title="Job not found" description="This role is missing, closed, or not approved yet." />;
  }

  const j = job.data;
  const companyName = j.companies?.name ?? "Company";
  const companyLogo = j.companies && "logo_url" in j.companies ? j.companies.logo_url : null;
  const plainDescription = stripDeadlineMarker(j.description);
  const applicationDeadline = resolveJobDeadline(j.application_deadline, j.description);
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
          <div className="flex items-start gap-4">
            <CompanyLogo logoUrl={companyLogo} companyName={companyName} />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight">About the role</h2>
              <p className="mt-1 text-sm text-muted-foreground">{companyName}</p>
            </div>
          </div>
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
            <form className="space-y-4" onSubmit={form.handleSubmit((v) => apply.mutate(v))} noValidate>
              <div className="space-y-2">
                <Label htmlFor="full_name">Name</Label>
                <Input
                  id="full_name"
                  autoComplete="name"
                  placeholder="Your full name"
                  {...form.register("full_name")}
                />
                {form.formState.errors.full_name && (
                  <p className="text-xs text-destructive">{form.formState.errors.full_name.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  {...form.register("email")}
                />
                {form.formState.errors.email && (
                  <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="cover_note">About you</Label>
                <Textarea
                  id="cover_note"
                  rows={4}
                  placeholder="A short description about yourself"
                  {...form.register("cover_note")}
                />
                {form.formState.errors.cover_note && (
                  <p className="text-xs text-destructive">{form.formState.errors.cover_note.message}</p>
                )}
              </div>

              {id && (
                <ResumePdfPicker
                  seekerId={id}
                  canPersist={canPersist}
                  applicationOverride
                  initial={resumeValue}
                  onChange={setResumeValue}
                />
              )}

              {(!canPersist || !resumeValue?.storagePath) && (
                <div className="space-y-2">
                  <Label htmlFor="resume_url">Resume URL{canPersist ? " (optional fallback)" : ""}</Label>
                  <Input id="resume_url" placeholder="https://…" {...form.register("resume_url")} />
                  {form.formState.errors.resume_url && (
                    <p className="text-xs text-destructive">{form.formState.errors.resume_url.message}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {canPersist
                      ? "Used only if you have not uploaded a PDF for this application."
                      : latestResume.data?.resume_url
                        ? "Prefilled from your profile or last application — edit if needed."
                        : (
                          <>
                            Until PDF upload storage is available, submit a public resume link. You can also save a
                            preferred URL on your{" "}
                            <Link to="/seeker/profile" className="text-signal underline">
                              profile
                            </Link>
                            .
                          </>
                        )}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="portfolio_url">Portfolio URL (optional)</Label>
                <Input
                  id="portfolio_url"
                  placeholder="https://…"
                  inputMode="url"
                  {...form.register("portfolio_url")}
                />
                {form.formState.errors.portfolio_url && (
                  <p className="text-xs text-destructive">{form.formState.errors.portfolio_url.message}</p>
                )}
                {!canPersist && (
                  <p className="text-xs text-muted-foreground">{PORTFOLIO_PERSISTENCE_NOTE}</p>
                )}
              </div>

              {deadlineLabel && (
                <p className="text-xs text-muted-foreground">Apply by {deadlineLabel}.</p>
              )}
              {apply.isError && (
                <p role="alert" className="text-xs text-destructive">
                  {(apply.error as Error).message}
                </p>
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
