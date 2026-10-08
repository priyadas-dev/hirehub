import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Building2, Calendar, MapPin } from "lucide-react";
import { toast } from "sonner";
import { CardSkeleton, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { JOB_TYPE_LABEL } from "@/lib/hirehub";
import { useAuth } from "@/lib/auth";
import { fmtDate, supabase } from "@/components/dashboard/parts";

const applySchema = z.object({
  resume_url: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^https?:\/\//i.test(v), "Resume must be a full URL starting with http"),
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

  const form = useForm<ApplyValues>({
    resolver: zodResolver(applySchema),
    defaultValues: { resume_url: "", cover_note: "" },
  });

  const apply = useMutation({
    mutationFn: async (values: ApplyValues) => {
      if (!id) throw new Error("Not signed in");

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
          resume_url: values.resume_url?.trim() || null,
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

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={companyName}
        title={j.title}
        description={`${JOB_TYPE_LABEL[j.job_type]} · Posted ${fmtDate(j.created_at)}`}
        actions={
          <Button variant="outline" asChild>
            <Link to="/seeker/jobs">Back to jobs</Link>
          </Button>
        }
      />

      <div className="grid gap-8 lg:grid-cols-5">
        <section className="surface-card space-y-4 p-6 lg:col-span-3">
          <h2 className="text-lg font-semibold">About the role</h2>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {j.description || "No description provided."}
          </p>
          <dl className="mt-6 grid gap-3 border-t pt-4 text-sm sm:grid-cols-2">
            <div className="flex gap-3">
              <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <dt className="text-muted-foreground">Company</dt>
                <dd className="font-medium">{companyName}</dd>
              </div>
            </div>
            <div className="flex gap-3">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <dt className="text-muted-foreground">Location</dt>
                <dd className="font-medium">{j.location ?? "Remote"}</dd>
              </div>
            </div>
            <div className="flex gap-3">
              <Briefcase className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <dt className="text-muted-foreground">Job type</dt>
                <dd className="font-medium">{JOB_TYPE_LABEL[j.job_type]}</dd>
              </div>
            </div>
            <div className="flex gap-3">
              <Calendar className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <dt className="text-muted-foreground">Posted</dt>
                <dd className="font-medium">{fmtDate(j.created_at)}</dd>
              </div>
            </div>
          </dl>
        </section>

        <section className="surface-card space-y-4 p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold">Apply</h2>
          {existingApp.data ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">You already applied to this role.</p>
              <Button asChild variant="signal">
                <Link to="/seeker/applications/$applicationId" params={{ applicationId: existingApp.data.id }}>
                  View application
                </Link>
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="cover_note">Cover note (optional)</Label>
                <Textarea id="cover_note" rows={4} placeholder="Optional note for the recruiter" {...form.register("cover_note")} />
              </div>
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
