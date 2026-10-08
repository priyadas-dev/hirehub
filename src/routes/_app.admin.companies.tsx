import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { fmtDate, supabase } from "@/components/dashboard/parts";

export const Route = createFileRoute("/_app/admin/companies")({
  head: () => ({
    meta: [
      { title: "Manage companies — HireHub" },
      { name: "description", content: "Review and approve company profiles." },
    ],
  }),
  component: AdminCompaniesPage,
});

function AdminCompaniesPage() {
  const { user } = useAuth();
  const id = user?.id;
  const qc = useQueryClient();

  const companies = useQuery({
    queryKey: ["admin-companies", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id,name,industry,website,status,created_at,profiles(full_name,email)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const approve = useMutation({
    mutationFn: async (companyId: string) => {
      const { error } = await supabase.from("companies").update({ status: "approved" }).eq("id", companyId);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Company approved");
      await qc.invalidateQueries({ queryKey: ["admin-companies"] });
      await qc.invalidateQueries({ queryKey: ["admin-attention"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-company"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-companies"] });
      await qc.invalidateQueries({ queryKey: ["admin-reports"] });
    },
    onError: (e: Error) => toast.error("Could not approve company", { description: e.message }),
  });

  const pending = companies.data?.filter((c) => c.status === "pending") ?? [];
  const approved = companies.data?.filter((c) => c.status === "approved") ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Manage companies"
        description="Approve recruiter company profiles waiting for review."
      />

      {companies.isLoading ? (
        <CardSkeleton rows={4} />
      ) : companies.isError ? (
        <ErrorState onRetry={() => void companies.refetch()} />
      ) : (
        <>
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">Pending ({pending.length})</h2>
            {pending.length ? (
              <ul className="surface-card divide-y">
                {pending.map((c) => (
                  <li key={c.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.industry || "Industry n/a"}
                        {c.website ? ` · ${c.website}` : ""} ·{" "}
                        {c.profiles?.full_name || c.profiles?.email || "Recruiter"} · {fmtDate(c.created_at)}
                      </p>
                    </div>
                    <Button size="sm" variant="signal" disabled={approve.isPending} onClick={() => approve.mutate(c.id)}>
                      Approve
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Building2} title="No pending companies" description="Nothing waiting for approval." />
            )}
          </section>

          {approved.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold">Approved</h2>
              <ul className="surface-card divide-y">
                {approved.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-4 px-5 py-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.industry || "Industry n/a"} · {fmtDate(c.created_at)}
                      </p>
                    </div>
                    <span className="rounded-full border px-2.5 py-1 text-xs capitalize">{c.status}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
