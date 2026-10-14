import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, PlusSquare, Settings } from "lucide-react";
import { toast } from "sonner";
import { CompanyImagePicker } from "@/components/company/CompanyImagePicker";
import { CompanyLogo } from "@/components/company/CompanyLogo";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { ContactProfileCard } from "@/components/profile/ContactProfileCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFileUploadsReady } from "@/hooks/use-file-uploads-ready";
import { useAuth } from "@/lib/auth";
import { saveCompanyLogoUrl } from "@/lib/company-image";
import { createPendingCompany, saveCompanyProfile } from "@/lib/company-profile";
import { isMissingSchemaError } from "@/lib/hirehub-storage";
import { fetchOwnProfile } from "@/lib/profile";
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
      { name: "description", content: "Your recruiter contact details and company profile." },
    ],
  }),
  component: CompanyPage,
});

function CompanyPage() {
  const { user, refresh } = useAuth();
  const id = user?.id;
  const qc = useQueryClient();
  const uploadsReady = useFileUploadsReady();
  const canPersist = !!uploadsReady.data;
  const [editingCompany, setEditingCompany] = useState(false);
  const [logoDraft, setLogoDraft] = useState<string | null>(null);

  const contact = useQuery({
    queryKey: ["recruiter-contact", id],
    enabled: !!id,
    queryFn: () => fetchOwnProfile(id!),
  });

  const company = useQuery({
    queryKey: ["recruiter-company", id],
    enabled: !!id,
    queryFn: async () => {
      const primary = await supabase
        .from("companies")
        .select("id,name,industry,website,status,rejection_reason,created_at,logo_url")
        .eq("recruiter_id", id!)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (primary.error && isMissingSchemaError(primary.error.message)) {
        const fallback = await supabase
          .from("companies")
          .select("id,name,industry,website,status,rejection_reason,created_at")
          .eq("recruiter_id", id!)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (fallback.error) {
          const older = await supabase
            .from("companies")
            .select("id,name,industry,website,status,created_at")
            .eq("recruiter_id", id!)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (older.error) throw older.error;
          return older.data
            ? { ...older.data, rejection_reason: null as string | null, logo_url: null as string | null }
            : null;
        }
        return fallback.data
          ? { ...fallback.data, logo_url: null as string | null }
          : null;
      }
      if (primary.error) throw primary.error;
      return primary.data;
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
      setLogoDraft(company.data.logo_url ?? null);
    } else if (company.isSuccess && !company.data) {
      form.reset({ name: "", industry: "", website: "" });
      setLogoDraft(null);
    }
  }, [company.data, company.isSuccess, form]);

  useEffect(() => {
    if (company.isSuccess && !company.data) setEditingCompany(true);
  }, [company.isSuccess, company.data]);

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!id) throw new Error("Not signed in");
      const payload = {
        name: values.name.trim(),
        industry: values.industry?.trim() || null,
        website: values.website?.trim() || null,
      };
      let companyId = company.data?.id;
      let status: string | undefined = company.data?.status;
      if (companyId) {
        const updated = await saveCompanyProfile(companyId, id, payload, {
          resubmitForReview: company.data?.status === "rejected",
        });
        status = updated.status;
      } else {
        companyId = await createPendingCompany(id, payload);
        status = "pending";
      }

      if (canPersist && companyId) {
        const previous = company.data?.logo_url ?? null;
        await saveCompanyLogoUrl(companyId, id, logoDraft);
        // If logo was cleared and previous was external URL only, nothing else to clean.
        void previous;
      }

      return { status, companyId };
    },
    onSuccess: async (result) => {
      const wasCreate = !company.data?.id;
      if (wasCreate || result?.status === "pending") {
        toast.success(wasCreate ? "Company submitted for admin approval" : "Company updated");
      } else {
        toast.success("Company updated");
      }
      setEditingCompany(false);
      await qc.invalidateQueries({ queryKey: ["recruiter-company", id] });
      await qc.invalidateQueries({ queryKey: ["recruiter-companies"] });
      await qc.invalidateQueries({ queryKey: ["admin-companies"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
      await qc.invalidateQueries({ queryKey: ["admin-attention"] });
    },
    onError: (e: Error) => toast.error("Could not save company", { description: e.message }),
  });

  if (contact.isLoading || company.isLoading || uploadsReady.isLoading) return <CardSkeleton rows={6} />;
  if (contact.isError) return <ErrorState onRetry={() => void contact.refetch()} />;
  if (company.isError) return <ErrorState onRetry={() => void company.refetch()} />;

  const profile = company.data;
  const exists = !!profile;
  const pending = profile?.status === "pending";
  const approved = profile?.status === "approved";
  const rejected = profile?.status === "rejected";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Recruiter"
        title="Profile"
        description="Your contact details and company information. An admin must approve the company before it is fully active."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/settings">
                <Settings /> Settings
              </Link>
            </Button>
            {approved ? (
              <Button variant="signal" size="sm" asChild>
                <Link to="/recruiter/jobs/new">
                  <PlusSquare /> Post a job
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />

      {user && contact.data && (
        <ContactProfileCard
          userId={user.id}
          role={user.role}
          email={contact.data.email || user.email}
          fullName={contact.data.full_name ?? ""}
          phone={contact.data.phone}
          queryKey={["recruiter-contact", id]}
          onSaved={async () => {
            await refresh();
            await contact.refetch();
          }}
        />
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Company information</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Edit name, industry, and website.
            </p>
          </div>
          {exists && !editingCompany && (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditingCompany(true)}>
              Edit company
            </Button>
          )}
        </div>

        {!exists && !editingCompany && (
          <EmptyState
            icon={Building2}
            title="No company yet"
            description="Add your company name, industry, and website. After you save, an admin reviews and approves the profile."
            className="py-8"
            action={
              <Button variant="signal" onClick={() => setEditingCompany(true)}>
                Create company profile
              </Button>
            }
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

        {rejected && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm sm:px-5">
            <p className="font-medium text-destructive">
              <span className="text-foreground">{profile?.name}</span> was rejected
            </p>
            {profile?.rejection_reason && (
              <p className="mt-1 text-muted-foreground">Reason: {profile.rejection_reason}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Update your company details below. An admin must approve again before you can post jobs.
            </p>
          </div>
        )}

        {exists && !editingCompany && (
          <dl className="surface-card grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
            <div className="flex items-center gap-3 sm:col-span-2">
              <CompanyLogo logoUrl={profile?.logo_url} companyName={profile?.name} className="size-14" />
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Company name</dt>
                <dd className="mt-1 text-sm font-medium">{profile?.name}</dd>
              </div>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Industry</dt>
              <dd className="mt-1 text-sm font-medium">{profile?.industry || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Website</dt>
              <dd className="mt-1 break-all text-sm font-medium">
                {profile?.website ? (
                  <a
                    href={profile.website}
                    className="text-signal underline-offset-4 hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {profile.website}
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</dt>
              <dd className="mt-1 text-sm font-medium capitalize">{profile?.status}</dd>
            </div>
            {profile?.created_at && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Created</dt>
                <dd className="mt-1 text-sm font-medium">{fmtDate(profile.created_at)}</dd>
              </div>
            )}
          </dl>
        )}

        {editingCompany && (
          <form
            className="surface-card max-w-xl space-y-5 p-5 sm:p-6"
            onSubmit={form.handleSubmit((v) => save.mutate(v))}
            noValidate
          >
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

            <CompanyImagePicker
              canPersist={canPersist}
              companyId={profile?.id ?? null}
              recruiterId={id ?? null}
              initialLogoUrl={logoDraft}
              onLogoChange={setLogoDraft}
            />

            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="signal" disabled={save.isPending}>
                {save.isPending
                  ? "Saving…"
                  : !exists
                    ? "Submit for approval"
                    : rejected
                      ? "Save & resubmit for approval"
                      : "Save changes"}
              </Button>
              {exists && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() => {
                    form.reset({
                      name: profile!.name,
                      industry: profile!.industry ?? "",
                      website: profile!.website ?? "",
                    });
                    setLogoDraft(profile!.logo_url ?? null);
                    setEditingCompany(false);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
            {save.isError && (
              <p role="alert" className="text-xs text-destructive">
                {(save.error as Error).message}
              </p>
            )}
          </form>
        )}
      </section>
    </div>
  );
}
