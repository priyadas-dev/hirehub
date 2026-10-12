import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { StatusBadge } from "@/components/status/StatusBadge";
import type { ApplicationStatus } from "@/components/status/status";
import { useAuth } from "@/lib/auth";
import { fmtDate, supabase } from "@/components/dashboard/parts";

export const Route = createFileRoute("/_app/admin/applications")({
  head: () => ({
    meta: [
      { title: "All applications — HireHub" },
      { name: "description", content: "Review every application across HireHub." },
    ],
  }),
  component: AdminApplicationsPage,
});

function AdminApplicationsPage() {
  const { user } = useAuth();
  const id = user?.id;

  const apps = useQuery({
    queryKey: ["admin-applications", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id,status,created_at,jobs(title,companies(name)),profiles(full_name,email)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="All applications"
        description="Every application on the platform with job, applicant, status, and date."
      />

      {apps.isLoading ? (
        <CardSkeleton rows={5} />
      ) : apps.isError ? (
        <ErrorState onRetry={() => void apps.refetch()} />
      ) : apps.data?.length ? (
        <div className="surface-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3 font-medium">Job</th>
                <th className="px-5 py-3 font-medium">Applicant</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {apps.data.map((a) => (
                <tr key={a.id}>
                  <td className="px-5 py-3">
                    <p className="font-medium">{a.jobs?.title ?? "Job"}</p>
                    <p className="text-xs text-muted-foreground">{a.jobs?.companies?.name ?? "Company"}</p>
                  </td>
                  <td className="px-5 py-3">
                    <p className="font-medium">{a.profiles?.full_name || "Applicant"}</p>
                    <p className="text-xs text-muted-foreground">{a.profiles?.email}</p>
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={a.status as ApplicationStatus} />
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{fmtDate(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title="No applications yet"
          description="Applications will show up here once seekers start applying."
        />
      )}
    </div>
  );
}
