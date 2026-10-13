import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { RejectReasonDialog } from "@/components/admin/RejectReasonDialog";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { adminReviewCompany } from "@/lib/review-api";
import { fmtDate, supabase } from "@/components/dashboard/parts";

export const Route = createFileRoute("/_app/admin/companies")({
  head: () => ({
    meta: [
      { title: "Manage companies — HireHub" },
      { name: "description", content: "Review, approve, or reject company profiles." },
    ],
  }),
  component: AdminCompaniesPage,
});

function AdminCompaniesPage() {
  const { user } = useAuth();
  const id = user?.id;
  const qc = useQueryClient();
  const [rejectId, setRejectId] = useState<string | null>(null);

  const companies = useQuery({
    queryKey: ["admin-companies", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id,name,industry,website,status,rejection_reason,created_at,profiles(full_name,email)")
        .order("created_at", { ascending: false });
      if (error) {
        const fallback = await supabase
          .from("companies")
          .select("id,name,industry,website,status,created_at,profiles(full_name,email)")
          .order("created_at", { ascending: false });
        if (fallback.error) throw fallback.error;
        return (fallback.data ?? []).map((c) => ({ ...c, rejection_reason: null as string | null }));
      }
      return data;
    },
  });

  const review = useMutation({
    mutationFn: (input: { companyId: string; decision: "approve" | "reject"; reason?: string }) =>
      adminReviewCompany(input),
    onSuccess: async (_, vars) => {
      toast.success(vars.decision === "approve" ? "Company approved" : "Company rejected");
      setRejectId(null);
      await qc.invalidateQueries({ queryKey: ["admin-companies"] });
      await qc.invalidateQueries({ queryKey: ["admin-attention"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-company"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-companies"] });
      await qc.invalidateQueries({ queryKey: ["admin-reports"] });
      await qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: Error) => toast.error("Could not review company", { description: e.message }),
  });

  const pending = companies.data?.filter((c) => c.status === "pending") ?? [];
  const rejected = companies.data?.filter((c) => c.status === "rejected") ?? [];
  const approved = companies.data?.filter((c) => c.status === "approved") ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Manage companies"
        description="Approve or reject recruiter company profiles. Rejection requires a reason the recruiter can see."
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
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="signal"
                        disabled={review.isPending}
                        onClick={() => review.mutate({ companyId: c.id, decision: "approve" })}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={review.isPending}
                        onClick={() => setRejectId(c.id)}
                      >
                        Reject
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Building2} title="No pending companies" description="Nothing waiting for approval." />
            )}
          </section>

          {rejected.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold">Rejected</h2>
              <ul className="surface-card divide-y">
                {rejected.map((c) => (
                  <li key={c.id} className="px-5 py-4">
                    <p className="font-medium">{c.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{fmtDate(c.created_at)}</p>
                    {c.rejection_reason && (
                      <p className="mt-2 text-sm text-destructive">Reason: {c.rejection_reason}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

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

      <RejectReasonDialog
        open={!!rejectId}
        onOpenChange={(open) => {
          if (!open) setRejectId(null);
        }}
        title="Reject company"
        busy={review.isPending}
        onConfirm={(reason) => {
          if (!rejectId) return;
          review.mutate({ companyId: rejectId, decision: "reject", reason });
        }}
      />
    </div>
  );
}
