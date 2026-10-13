import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { StatusBadge } from "@/components/status/StatusBadge";
import type { ApplicationStatus } from "@/components/status/status";
import { Button } from "@/components/ui/button";
import { nextApplicationStatuses, STATUS_ACTION_LABEL } from "@/lib/hirehub";
import { updateApplicationStatusWithNotification } from "@/lib/notify-application-status";
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
  const qc = useQueryClient();

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

  const updateStatus = useMutation({
    mutationFn: (input: {
      applicationId: string;
      from: ApplicationStatus;
      status: ApplicationStatus;
    }) => updateApplicationStatusWithNotification(input),
    onSuccess: async () => {
      toast.success("Application status updated");
      await qc.invalidateQueries({ queryKey: ["admin-applications"] });
      await qc.invalidateQueries({ queryKey: ["admin-reports"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-applicants"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-pipeline-counts"] });
      await qc.invalidateQueries({ queryKey: ["seeker-applications"] });
      await qc.invalidateQueries({ queryKey: ["seeker-application"] });
      await qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: async (e: Error) => {
      await qc.invalidateQueries({ queryKey: ["admin-applications"] });
      await qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.error("Could not update status", { description: e.message });
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="All applications"
        description="Every application on the platform with job, applicant, status, and date. Admins can advance status; seekers are notified in-app."
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
                <th className="px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {apps.data.map((a) => {
                const current = a.status as ApplicationStatus;
                const next = nextApplicationStatuses(current);
                return (
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
                      <StatusBadge status={current} />
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{fmtDate(a.created_at)}</td>
                    <td className="px-5 py-3">
                      {next.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Final</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {next.map((s) => (
                            <Button
                              key={s}
                              size="sm"
                              variant={s === "rejected" ? "outline" : "signal"}
                              disabled={updateStatus.isPending}
                              onClick={() =>
                                updateStatus.mutate({
                                  applicationId: a.id,
                                  from: current,
                                  status: s,
                                })
                              }
                            >
                              {updateStatus.isPending ? "Updating…" : (STATUS_ACTION_LABEL[s] ?? s)}
                            </Button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
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
