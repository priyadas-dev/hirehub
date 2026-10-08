import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { StatusBadge } from "@/components/status/StatusBadge";
import type { ApplicationStatus } from "@/components/status/status";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { fmtDate, supabase } from "@/components/dashboard/parts";

export const Route = createFileRoute("/_app/seeker/applications/")({
  head: () => ({
    meta: [
      { title: "My Applications — HireHub" },
      { name: "description", content: "Track your job applications." },
    ],
  }),
  component: MyApplicationsPage,
});

function MyApplicationsPage() {
  const { user } = useAuth();
  const id = user?.id;
  const apps = useQuery({
    queryKey: ["seeker-applications", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id,status,created_at,jobs(title,location,companies(name))")
        .eq("seeker_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Job Seeker"
        title="My applications"
        description="Follow every application from Applied through to Hired or Not selected."
      />

      {apps.isLoading ? (
        <CardSkeleton rows={4} />
      ) : apps.isError ? (
        <ErrorState onRetry={() => void apps.refetch()} />
      ) : apps.data?.length ? (
        <ul className="surface-card divide-y overflow-hidden">
          {apps.data.map((a) => (
            <li key={a.id} className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-muted/35 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium tracking-tight">{a.jobs?.title ?? "Job"}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {a.jobs?.companies?.name ?? "Company"} · Applied {fmtDate(a.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={a.status as ApplicationStatus} />
                <Button size="sm" variant="outline" asChild>
                  <Link to="/seeker/applications/$applicationId" params={{ applicationId: a.id }}>
                    Track
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={FileText}
          title="No applications yet"
          description="Browse approved jobs and submit your first application."
          action={
            <Button variant="signal" asChild>
              <Link to="/seeker/jobs">Browse jobs</Link>
            </Button>
          }
        />
      )}
    </div>
  );
}
