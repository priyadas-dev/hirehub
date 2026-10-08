import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, PlusSquare } from "lucide-react";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { JOB_TYPE_LABEL } from "@/lib/hirehub";
import { useAuth } from "@/lib/auth";
import { fmtDate, supabase } from "@/components/dashboard/parts";

export const Route = createFileRoute("/_app/recruiter/jobs/")({
  head: () => ({
    meta: [
      { title: "My job posts — HireHub" },
      { name: "description", content: "Manage your job listings." },
    ],
  }),
  component: MyJobsPage,
});

function MyJobsPage() {
  const { user } = useAuth();
  const id = user?.id;

  const jobs = useQuery({
    queryKey: ["recruiter-jobs", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,title,location,job_type,status,created_at,companies(name)")
        .eq("recruiter_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Recruiter"
        title="My job posts"
        description="Track listing status. Pending roles appear for seekers after an admin approves them."
        actions={
          <Button variant="signal" asChild>
            <Link to="/recruiter/jobs/new">
              <PlusSquare /> Post a job
            </Link>
          </Button>
        }
      />

      {jobs.isLoading ? (
        <CardSkeleton rows={4} />
      ) : jobs.isError ? (
        <ErrorState onRetry={() => void jobs.refetch()} />
      ) : jobs.data?.length ? (
        <ul className="surface-card divide-y">
          {jobs.data.map((j) => (
            <li key={j.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium">{j.title}</p>
                <p className="text-xs text-muted-foreground">
                  {j.companies?.name ?? "Company"} · {j.location ?? "Remote"} · {JOB_TYPE_LABEL[j.job_type]} ·{" "}
                  {fmtDate(j.created_at)}
                </p>
              </div>
              <span className="w-fit rounded-full border px-2.5 py-1 text-xs font-medium capitalize">{j.status}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={Briefcase}
          title="No job posts yet"
          description="Create a company profile if needed, then post your first role."
          action={
            <Button variant="signal" asChild>
              <Link to="/recruiter/jobs/new">Post a job</Link>
            </Button>
          }
        />
      )}
    </div>
  );
}
