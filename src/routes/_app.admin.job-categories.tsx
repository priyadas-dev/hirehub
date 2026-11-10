import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe2 } from "lucide-react";
import { toast } from "sonner";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createGlobalJobCategory,
  fetchJobCategoryCatalog,
  JOB_CATEGORY_CATALOG_QUERY_KEY,
  updateGlobalJobCategory,
} from "@/lib/job-category-catalog";
import { JOB_CATEGORIES } from "@/lib/job-categories";

export const Route = createFileRoute("/_app/admin/job-categories")({
  head: () => ({
    meta: [
      { title: "Global job categories — HireHub" },
      { name: "description", content: "Manage organization-wide job categories for all recruiters." },
    ],
  }),
  component: AdminJobCategoriesPage,
});

export function AdminJobCategoriesPage() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");

  const catalog = useQuery({
    queryKey: JOB_CATEGORY_CATALOG_QUERY_KEY,
    queryFn: fetchJobCategoryCatalog,
  });

  const globalRows = useMemo(
    () => (catalog.data?.rows ?? []).filter((r) => r.scope === "global"),
    [catalog.data?.rows],
  );

  const create = useMutation({
    mutationFn: () => createGlobalJobCategory(newName),
    onSuccess: async () => {
      toast.success("Global category created");
      setNewName("");
      await qc.invalidateQueries({ queryKey: JOB_CATEGORY_CATALOG_QUERY_KEY });
    },
    onError: (e: Error) => toast.error("Could not create category", { description: e.message }),
  });

  const update = useMutation({
    mutationFn: (input: { id: string; name?: string; active?: boolean }) => updateGlobalJobCategory(input),
    onSuccess: async () => {
      toast.success("Category updated");
      await qc.invalidateQueries({ queryKey: JOB_CATEGORY_CATALOG_QUERY_KEY });
    },
    onError: (e: Error) => toast.error("Could not update category", { description: e.message }),
  });

  if (catalog.isLoading) return <CardSkeleton rows={4} />;
  if (catalog.isError) return <ErrorState onRetry={() => void catalog.refetch()} />;

  if (catalog.data?.unavailable) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Admin" title="Global job categories" />
        <EmptyState
          icon={Globe2}
          title="Catalog not enabled"
          description="Apply PROPOSED_0024 on the database to manage global categories."
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Global job categories"
        description="Categories every recruiter can use. You cannot view or manage recruiters' private categories."
      />

      <section className="surface-card space-y-3 p-5">
        <p className="text-sm font-semibold">System defaults (read-only)</p>
        <p className="text-xs text-muted-foreground">{JOB_CATEGORIES.join(" · ")}</p>
      </section>

      <section className="surface-card space-y-4 p-5">
        <p className="text-sm font-semibold">Add global category</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="global-cat-name">Name</Label>
            <Input
              id="global-cat-name"
              value={newName}
              maxLength={80}
              placeholder="e.g. Healthcare"
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <Button
            variant="signal"
            disabled={create.isPending || newName.trim().length < 1}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Adding…" : "Add"}
          </Button>
        </div>
      </section>

      <section className="surface-card divide-y">
        <div className="px-5 py-3 text-sm font-semibold">Global ({globalRows.length})</div>
        {globalRows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No admin global categories yet.</p>
        ) : (
          globalRows.map((row) => (
            <div
              key={row.id}
              className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium">{row.name}</p>
                <p className="text-xs text-muted-foreground">{row.active ? "Active" : "Inactive"}</p>
              </div>
              <div className="flex gap-2">
                {row.active ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ id: row.id, active: false })}
                  >
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ id: row.id, active: true })}
                  >
                    Reactivate
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
