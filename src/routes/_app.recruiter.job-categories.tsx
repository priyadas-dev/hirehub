import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tags } from "lucide-react";
import { toast } from "sonner";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import {
  fetchJobCategoryCatalog,
  JOB_CATEGORY_CATALOG_QUERY_KEY,
  updateRecruiterJobCategory,
} from "@/lib/job-category-catalog";
import type { JobCategoryRow } from "@/lib/job-categories";

export const Route = createFileRoute("/_app/recruiter/job-categories")({
  head: () => ({
    meta: [
      { title: "My job categories — HireHub" },
      { name: "description", content: "Rename or deactivate your private job categories." },
    ],
  }),
  component: RecruiterJobCategoriesPage,
});

function RecruiterJobCategoriesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const catalog = useQuery({
    queryKey: JOB_CATEGORY_CATALOG_QUERY_KEY,
    enabled: !!user?.id,
    queryFn: fetchJobCategoryCatalog,
  });

  const mine = useMemo(
    () =>
      (catalog.data?.rows ?? []).filter(
        (r) => r.scope === "recruiter" && r.owner_recruiter_id === user?.id,
      ),
    [catalog.data?.rows, user?.id],
  );

  const save = useMutation({
    mutationFn: (input: { id: string; name?: string; active?: boolean }) => updateRecruiterJobCategory(input),
    onSuccess: async () => {
      toast.success("Category updated");
      setEditingId(null);
      await qc.invalidateQueries({ queryKey: JOB_CATEGORY_CATALOG_QUERY_KEY });
    },
    onError: (e: Error) => toast.error("Could not update category", { description: e.message }),
  });

  if (catalog.isLoading) return <CardSkeleton rows={4} />;
  if (catalog.isError) return <ErrorState onRetry={() => void catalog.refetch()} />;

  if (catalog.data?.unavailable) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Recruiter"
          title="My job categories"
          description="Private categories for your job posts."
        />
        <EmptyState
          icon={Tags}
          title="Categories not enabled yet"
          description="Apply PROPOSED_0024 (job category catalog) on the database to manage private categories."
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Recruiter"
        title="My job categories"
        description="Private categories only you can use. Deactivating hides a category from new jobs; existing jobs keep their assignment."
        actions={
          <Button variant="outline" asChild>
            <Link to="/recruiter/jobs/new">Post a job</Link>
          </Button>
        }
      />

      {mine.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No private categories yet"
          description="Create categories from Post a job or Edit job using the + button next to the category field."
          action={
            <Button variant="signal" asChild>
              <Link to="/recruiter/jobs/new">Post a job</Link>
            </Button>
          }
        />
      ) : (
        <ul className="surface-card divide-y">
          {mine.map((row) => (
            <CategoryRowEditor
              key={row.id}
              row={row}
              editingId={editingId}
              editName={editName}
              busy={save.isPending}
              onStartEdit={() => {
                setEditingId(row.id);
                setEditName(row.name);
              }}
              onCancelEdit={() => setEditingId(null)}
              onEditNameChange={setEditName}
              onSaveRename={() => save.mutate({ id: row.id, name: editName })}
              onDeactivate={() => save.mutate({ id: row.id, active: false })}
              onReactivate={() => save.mutate({ id: row.id, active: true })}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryRowEditor(props: {
  row: JobCategoryRow;
  editingId: string | null;
  editName: string;
  busy: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onEditNameChange: (v: string) => void;
  onSaveRename: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
}) {
  const { row, editingId, editName, busy } = props;
  const isEditing = editingId === row.id;

  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1">
        {isEditing ? (
          <div className="space-y-2">
            <Label htmlFor={`cat-${row.id}`}>Name</Label>
            <Input
              id={`cat-${row.id}`}
              value={editName}
              maxLength={80}
              onChange={(e) => props.onEditNameChange(e.target.value)}
            />
          </div>
        ) : (
          <>
            <p className="font-medium">{row.name}</p>
            <p className="text-xs text-muted-foreground">
              {row.active ? "Active" : "Inactive — not available for new jobs"}
            </p>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {isEditing ? (
          <>
            <Button size="sm" variant="signal" disabled={busy} onClick={props.onSaveRename}>
              Save
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={props.onCancelEdit}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" disabled={busy || !row.active} onClick={props.onStartEdit}>
              Rename
            </Button>
            {row.active ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={props.onDeactivate}>
                Deactivate
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={busy} onClick={props.onReactivate}>
                Reactivate
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}
