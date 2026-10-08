import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { JOB_TYPE_LABEL, type JobType } from "@/lib/hirehub";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/components/dashboard/parts";

const schema = z.object({
  company_id: z.string().min(1, "Select a company"),
  title: z.string().trim().min(2, "Title is required"),
  description: z.string().trim().optional(),
  location: z.string().trim().optional(),
  salary_range: z.string().trim().optional(),
  job_type: z.enum(["full_time", "part_time", "contract"]),
});

type FormValues = z.infer<typeof schema>;

export const Route = createFileRoute("/_app/recruiter/jobs/new")({
  head: () => ({
    meta: [
      { title: "Post a job — HireHub" },
      { name: "description", content: "Submit a new job for admin approval." },
    ],
  }),
  component: PostJobPage,
});

function PostJobPage() {
  const { user } = useAuth();
  const id = user?.id;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const companies = useQuery({
    queryKey: ["recruiter-companies", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id,name,status")
        .eq("recruiter_id", id!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      company_id: "",
      title: "",
      description: "",
      location: "",
      salary_range: "",
      job_type: "full_time",
    },
  });

  useEffect(() => {
    if (!form.getValues("company_id") && companies.data?.length === 1 && companies.data[0]) {
      form.setValue("company_id", companies.data[0].id);
    }
  }, [companies.data, form]);

  const post = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!id) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("jobs")
        .insert({
          title: values.title.trim(),
          description: values.description?.trim() || null,
          location: values.location?.trim() || null,
          salary_range: values.salary_range?.trim() || null,
          job_type: values.job_type as JobType,
          company_id: values.company_id,
          recruiter_id: id,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      toast.success("Job submitted for approval");
      await qc.invalidateQueries({ queryKey: ["recruiter-jobs"] });
      await qc.invalidateQueries({ queryKey: ["rec-jobs"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
      await qc.invalidateQueries({ queryKey: ["admin-attention"] });
      void navigate({ to: "/recruiter/jobs" });
    },
    onError: (e: Error) => toast.error("Could not post job", { description: e.message }),
  });

  if (companies.isLoading) return <CardSkeleton rows={5} />;
  if (companies.isError) return <ErrorState onRetry={() => void companies.refetch()} />;

  if (!companies.data?.length) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Recruiter" title="Post a job" description="Create a company profile before posting roles." />
        <EmptyState
          icon={Building2}
          title="Company required"
          description="Add your company first, then come back to post a job."
          action={
            <Button variant="signal" asChild>
              <Link to="/recruiter/company">Set up company</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Recruiter"
        title="Post a job"
        description="New listings start as pending until an admin approves them."
        actions={
          <Button variant="outline" asChild>
            <Link to="/recruiter/jobs">Back to jobs</Link>
          </Button>
        }
      />

      <form className="surface-card max-w-xl space-y-5 p-6" onSubmit={form.handleSubmit((v) => post.mutate(v))}>
        <div className="space-y-2">
          <Label>Company</Label>
          <Select value={form.watch("company_id")} onValueChange={(v) => form.setValue("company_id", v, { shouldValidate: true })}>
            <SelectTrigger>
              <SelectValue placeholder="Select company" />
            </SelectTrigger>
            <SelectContent>
              {companies.data.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} ({c.status})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.formState.errors.company_id && (
            <p className="text-xs text-destructive">{form.formState.errors.company_id.message}</p>
          )}
          {companies.data.find((c) => c.id === form.watch("company_id"))?.status === "pending" && (
            <p className="text-xs text-muted-foreground">
              This company is still pending admin approval. You can submit the job now; it will also wait for review.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="title">Job title</Label>
          <Input id="title" {...form.register("title")} placeholder="Senior Engineer" />
          {form.formState.errors.title && (
            <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" rows={5} {...form.register("description")} placeholder="Role details…" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Input id="location" {...form.register("location")} placeholder="Remote / City" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="salary_range">Salary range</Label>
            <Input id="salary_range" {...form.register("salary_range")} placeholder="e.g. $80k–$100k" />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Job type</Label>
          <Select
            value={form.watch("job_type")}
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
        <Button type="submit" variant="signal" disabled={post.isPending}>
          {post.isPending ? "Submitting…" : "Submit for approval"}
        </Button>
      </form>
    </div>
  );
}
