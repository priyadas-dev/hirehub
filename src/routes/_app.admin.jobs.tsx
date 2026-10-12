import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { JOB_TYPE_LABEL } from "@/lib/hirehub";
import { useAuth } from "@/lib/auth";
import { fmtDate, supabase } from "@/components/dashboard/parts";

const searchSchema = z.object({
  q: z.string().optional(),
});

export const Route = createFileRoute("/_app/admin/jobs")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Approve jobs — HireHub" },
      { name: "description", content: "Review and approve pending job listings." },
    ],
  }),
  component: AdminJobsPage,
});

function AdminJobsPage() {
  const { user } = useAuth();
  const id = user?.id;
  const qc = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const q = search.q?.trim().toLowerCase() ?? "";

  const jobs = useQuery({
    queryKey: ["admin-jobs", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,title,location,job_type,status,created_at,companies(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ jobId, status }: { jobId: string; status: "approved" | "closed" }) => {
      const { error } = await supabase.from("jobs").update({ status }).eq("id", jobId);
      if (error) throw error;
    },
    onSuccess: async (_, vars) => {
      toast.success(vars.status === "approved" ? "Job approved" : "Job closed");
      await qc.invalidateQueries({ queryKey: ["admin-jobs"] });
      await qc.invalidateQueries({ queryKey: ["admin-attention"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
      await qc.invalidateQueries({ queryKey: ["seeker-jobs"] });
      await qc.invalidateQueries({ queryKey: ["seeker-recommended"] });
      await qc.invalidateQueries({ queryKey: ["recruiter-jobs"] });
      await qc.invalidateQueries({ queryKey: ["rec-jobs"] });
      await qc.invalidateQueries({ queryKey: ["admin-reports"] });
    },
    onError: (e: Error) => toast.error("Could not update job", { description: e.message }),
  });

  const filtered = useMemo(() => {
    const list = jobs.data ?? [];
    if (!q) return list;
    return list.filter((j) => {
      const hay = `${j.title} ${j.companies?.name ?? ""} ${j.location ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [jobs.data, q]);

  const pending = filtered.filter((j) => j.status === "pending");
  const others = filtered.filter((j) => j.status !== "pending");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Approve jobs"
        description="Approve pending listings so seekers can browse and apply. Close roles that should leave the board."
      />

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by title, company, or location…"
          value={search.q ?? ""}
          onChange={(e) =>
            void navigate({
              search: (prev) => ({
                ...prev,
                q: e.target.value.trim() ? e.target.value : undefined,
              }),
              replace: true,
            })
          }
          autoComplete="off"
        />
      </div>

      {jobs.isLoading ? (
        <CardSkeleton rows={4} />
      ) : jobs.isError ? (
        <ErrorState onRetry={() => void jobs.refetch()} />
      ) : (
        <>
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">Pending approval ({pending.length})</h2>
            {pending.length ? (
              <ul className="surface-card divide-y">
                {pending.map((j) => (
                  <li
                    key={j.id}
                    className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{j.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {j.companies?.name ?? "Company"} · {j.location ?? "Remote"} ·{" "}
                        {JOB_TYPE_LABEL[j.job_type]} · {fmtDate(j.created_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="signal"
                        disabled={updateStatus.isPending}
                        onClick={() => updateStatus.mutate({ jobId: j.id, status: "approved" })}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updateStatus.isPending}
                        onClick={() => updateStatus.mutate({ jobId: j.id, status: "closed" })}
                      >
                        Close
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={ShieldCheck}
                title={q ? "No pending jobs match" : "No pending jobs"}
                description={
                  q ? "Try another search term or clear the header search." : "All submitted roles are reviewed."
                }
              />
            )}
          </section>

          {others.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold">Reviewed jobs</h2>
              <ul className="surface-card divide-y">
                {others.map((j) => (
                  <li
                    key={j.id}
                    className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{j.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {j.companies?.name ?? "Company"} · {fmtDate(j.created_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border px-2.5 py-1 text-xs font-medium capitalize">
                        {j.status}
                      </span>
                      {j.status === "approved" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={updateStatus.isPending}
                          onClick={() => updateStatus.mutate({ jobId: j.id, status: "closed" })}
                        >
                          Close
                        </Button>
                      )}
                      {j.status === "closed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={updateStatus.isPending}
                          onClick={() => updateStatus.mutate({ jobId: j.id, status: "approved" })}
                        >
                          Re-open
                        </Button>
                      )}
                    </div>
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
