import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, PlusSquare } from "lucide-react";
import { toast } from "sonner";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { createPendingCompany, saveCompanyProfile } from "@/lib/company-profile";
import { fmtDate, supabase } from "@/components/dashboard/parts";

const schema = z.object({
  name: z.string().trim().min(2, "Company name is required"),
  industry: z.string().trim().optional(),
  website: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^https?:\/\//i.test(v), "Website must start with http:// or https://"),
});

type FormValues = z.infer<typeof schema>;

export const Route = createFileRoute("/_app/recruiter/company")({
  head: () => ({
    meta: [
      { title: "Company profile — HireHub" },
      { name: "description", content: "Create or update your company profile." },
    ],
  }),
  component: CompanyPage,
});

function CompanyPage() {
  const { user } = useAuth();
  const id = user?.id;
  const qc = useQueryClient();

  const company = useQuery({
    queryKey: ["recruiter-company", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id,name,industry,website,status,created_at")
        .eq("recruiter_id", id!)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", industry: "", website: "" },
  });

  useEffect(() => {
    if (company.data) {
      form.reset({
        name: company.data.name,
        industry: company.data.industry ?? "",
        website: company.data.website ?? "",
      });
    }
  }, [company.data, form]);

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!id) throw new Error("Not signed in");
      const payload = {
        name: values.name.trim(),
        industry: values.industry?.trim() || null,
        website: values.website?.trim() || null,
      };
      if (company.data?.id) {
        return saveCompanyProfile(company.data.id, id, payload);
      }
      await createPendingCompany(id, payload);
      return { status: "pending" as const };
    },
    onSuccess: async (result) => {
      const wasCreate = !company.data?.id;
      if (wasCreate || result?.status === "pending") {
        toast.success(wasCreate ? "Company submitted for admin approval" : "Company updated");
      } else {
        toast.success("Company updated");
      }
      await qc.invalidateQueries({ queryKey: ["recruiter-company", id] });
      await qc.invalidateQueries({ queryKey: ["recruiter-companies"] });
      await qc.invalidateQueries({ queryKey: ["admin-companies"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
      await qc.invalidateQueries({ queryKey: ["admin-attention"] });
    },
    onError: (e: Error) => toast.error("Could not save company", { description: e.message }),
  });

  if (company.isLoading) return <CardSkeleton rows={5} />;
  if (company.isError) return <ErrorState onRetry={() => void company.refetch()} />;

  const profile = company.data;
  const exists = !!profile;
  const pending = profile?.status === "pending";
  const approved = profile?.status === "approved";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Recruiter"
        title="Company profile"
        description="Create your company profile. An admin must approve it before it is fully active. Job posts also need a separate admin approval."
        actions={
          approved ? (
            <Button variant="signal" asChild>
              <Link to="/recruiter/jobs/new">
                <PlusSquare /> Post a job
              </Link>
            </Button>
          ) : undefined
        }
      />

      {!exists && (
        <EmptyState
          icon={Building2}
          title="No company yet"
          description="Add your company name, industry, and website. After you save, an admin reviews and approves the profile."
          className="py-8"
        />
      )}

      {pending && (
        <div className="rounded-2xl border border-status-interview/40 bg-status-interview-soft/50 px-4 py-3 text-sm sm:px-5">
          <span className="font-medium">{profile?.name}</span> is pending admin approval. You can edit details while
          you wait. Job posts also need admin approval before seekers can apply.
        </div>
      )}

      {approved && (
        <div className="rounded-2xl border bg-card px-4 py-3 text-sm sm:px-5">
          <span className="font-medium">{profile?.name}</span> is approved. Post a job whenever you are ready — new
          listings stay pending until an admin approves them for seekers.
        </div>
      )}

      <form
        className="surface-card max-w-xl space-y-5 p-5 sm:p-6"
        onSubmit={form.handleSubmit((v) => save.mutate(v))}
      >
        {profile?.created_at && (
          <p className="text-sm text-muted-foreground">Created {fmtDate(profile.created_at)}</p>
        )}
        <div className="space-y-2">
          <Label htmlFor="name">Company name</Label>
          <Input id="name" {...form.register("name")} placeholder="Acme Corp" />
          {form.formState.errors.name && (
            <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="industry">Industry</Label>
          <Input id="industry" {...form.register("industry")} placeholder="Technology" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="website">Website</Label>
          <Input id="website" {...form.register("website")} placeholder="https://…" />
          {form.formState.errors.website && (
            <p className="text-xs text-destructive">{form.formState.errors.website.message}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="signal" disabled={save.isPending}>
            {save.isPending ? "Saving…" : exists ? "Save changes" : "Submit for approval"}
          </Button>
          {exists && (
            <Button type="button" variant="outline" asChild>
              <Link to="/recruiter/jobs">My job posts</Link>
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
