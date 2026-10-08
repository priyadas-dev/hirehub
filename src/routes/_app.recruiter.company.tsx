import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
import { useAuth } from "@/lib/auth";
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
        const { error } = await supabase.from("companies").update(payload).eq("id", company.data.id).eq("recruiter_id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("companies").insert({ ...payload, recruiter_id: id });
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      toast.success(company.data ? "Company updated" : "Company created");
      await qc.invalidateQueries({ queryKey: ["recruiter-company", id] });
      await qc.invalidateQueries({ queryKey: ["recruiter-companies"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
      await qc.invalidateQueries({ queryKey: ["admin-attention"] });
    },
    onError: (e: Error) => toast.error("Could not save company", { description: e.message }),
  });

  if (company.isLoading) return <CardSkeleton rows={5} />;
  if (company.isError) return <ErrorState onRetry={() => void company.refetch()} />;

  const status = company.data?.status;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Recruiter"
        title="Company profile"
        description="Set up your company before posting jobs. New companies wait for admin approval."
      />

      {!company.data && (
        <EmptyState
          icon={Building2}
          title="No company yet"
          description="Add your company details below. You can post jobs once the profile is saved."
          className="py-8"
        />
      )}

      <form className="surface-card max-w-xl space-y-5 p-6" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        {status && (
          <p className="text-sm text-muted-foreground">
            Status:{" "}
            <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize">{status}</span>
            {company.data?.created_at ? ` · Created ${fmtDate(company.data.created_at)}` : null}
          </p>
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
        <Button type="submit" variant="signal" disabled={save.isPending}>
          {save.isPending ? "Saving…" : company.data ? "Save changes" : "Create company"}
        </Button>
      </form>
    </div>
  );
}
