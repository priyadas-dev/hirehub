import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Pencil, PlusSquare, Users } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { JOB_TYPE_LABEL } from "@/lib/hirehub";
import {
  fmtDeadline,
  JOB_STATUS_BADGE_CLASS,
  JOB_STATUS_LABEL,
  unpackJobDescription,
  type JobStatus,
} from "@/lib/job-fields";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { fmtDate, supabase } from "@/components/dashboard/parts";

const searchSchema = z.object({
  status: z.enum(["pending", "approved", "closed"]).optional(),
  q: z.string().optional(),
});

export const Route = createFileRoute("/_app/recruiter/jobs/")({
  validateSearch: searchSchema,
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
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const titleQuery = (search.q ?? "").trim();

  const jobs = useQuery({
    queryKey: ["recruiter-jobs", id, search.status, titleQuery],
    enabled: !!id,
    queryFn: async () => {
      let q = supabase
        .from("jobs")
        .select("id,title,location,job_type,status,created_at,description,companies(name),applications(count)")
        .eq("recruiter_id", id!)
        .order("created_at", { ascending: false });
      if (search.status) q = q.eq("status", search.status);
      if (titleQuery) q = q.ilike("title", `%${titleQuery}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const closeJob = useMutation({
    mutationFn: async (jobId: string) => {
      if (!id) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("jobs")
        .update({ status: "closed" })
        .eq("id", jobId)
        .eq("recruiter_id", id)
        .neq("status", "closed")
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Job was already closed.");
    },
    onSuccess: async () => {
      toast.success("Job closed");
      await qc.invalidateQueries({ queryKey: ["recruiter-jobs"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-jobs-lite"] });
      await qc.invalidateQueries({ queryKey: ["rec-jobs"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
      await qc.invalidateQueries({ queryKey: ["seeker-jobs"] });
      await qc.invalidateQueries({ queryKey: ["seeker-recommended"] });
      await qc.invalidateQueries({ queryKey: ["admin-jobs"] });
    },
    onError: (e: Error) => toast.error("Could not close job", { description: e.message }),
  });

  const filteredCount = jobs.data?.length ?? 0;
  const hasFilters = !!search.status || !!titleQuery;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Recruiter"
        title="My job posts"
        description="Edit listings, close roles that are filled, and jump to applicants."
        actions={
          <Button variant="signal" asChild>
            <Link to="/recruiter/jobs/new">
              <PlusSquare /> Post a job
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Input
            value={search.q ?? ""}
            onChange={(e) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  q: e.target.value || undefined,
                }),
              })
            }
            placeholder="Search by job title…"
            className="w-full sm:max-w-xs"
            aria-label="Search by job title"
          />
          <Select
            value={search.status ?? "all"}
            onValueChange={(v) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  status: v === "all" ? undefined : (v as JobStatus),
                }),
              })
            }
          >
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(Object.keys(JOB_STATUS_LABEL) as JobStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {JOB_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void navigate({ search: { status: undefined, q: undefined } })}
            >
              Clear filters
            </Button>
          )}
        </div>
        {!jobs.isLoading && !jobs.isError && (
          <p className="text-sm text-muted-foreground">
            {filteredCount} listing{filteredCount === 1 ? "" : "s"}
            {search.status ? ` · ${JOB_STATUS_LABEL[search.status]}` : ""}
            {titleQuery ? ` · “${titleQuery}”` : ""}
          </p>
        )}
      </div>

      {jobs.isLoading ? (
        <CardSkeleton rows={4} />
      ) : jobs.isError ? (
        <ErrorState onRetry={() => void jobs.refetch()} />
      ) : jobs.data?.length ? (
        <ul className="surface-card divide-y">
          {jobs.data.map((j) => {
            const appCount = Array.isArray(j.applications) ? (j.applications[0]?.count ?? 0) : 0;
            const canEdit = j.status !== "closed";
            const canClose = j.status === "approved" || j.status === "pending";
            const deadline = unpackJobDescription(j.description).applicationDeadline;
            const status = j.status as JobStatus;
            return (
              <li
                key={j.id}
                className="flex flex-col gap-4 px-4 py-4 sm:px-5 sm:py-5 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{j.title}</p>
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                        JOB_STATUS_BADGE_CLASS[status],
                      )}
                    >
                      {JOB_STATUS_LABEL[status]}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {j.companies?.name ?? "Company"} · {j.location ?? "Remote"} · {JOB_TYPE_LABEL[j.job_type]} ·{" "}
                    {fmtDate(j.created_at)}
                    {deadline ? ` · Deadline ${fmtDeadline(deadline)}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {appCount} applicant{appCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/recruiter/applicants" search={{ jobId: j.id }}>
                      <Users /> Applicants
                    </Link>
                  </Button>
                  {canEdit && (
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/recruiter/jobs/$jobId/edit" params={{ jobId: j.id }}>
                        <Pencil /> Edit
                      </Link>
                    </Button>
                  )}
                  {canClose && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" disabled={closeJob.isPending}>
                          Close
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Close this job?</AlertDialogTitle>
                          <AlertDialogDescription>
                            “{j.title}” will no longer appear to seekers. Existing applications stay available for
                            review.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => closeJob.mutate(j.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Close job
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={Briefcase}
          title={hasFilters ? "No jobs match these filters" : "No job posts yet"}
          description={
            hasFilters
              ? "Try another title or status, or clear filters to see all listings."
              : "Create your company if you have not yet, then post a role. The company is active immediately; the job stays pending until an admin approves it."
          }
          action={
            hasFilters ? (
              <Button
                variant="outline"
                onClick={() => void navigate({ search: { status: undefined, q: undefined } })}
              >
                Clear filters
              </Button>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" asChild>
                  <Link to="/recruiter/company">Company profile</Link>
                </Button>
                <Button variant="signal" asChild>
                  <Link to="/recruiter/jobs/new">Post a job</Link>
                </Button>
              </div>
            )
          }
        />
      )}
    </div>
  );
}
