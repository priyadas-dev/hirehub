import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_JOB_CATEGORY_ID,
  groupCategoriesForPicker,
  type JobCategoryRow,
} from "@/lib/job-categories";
import {
  createRecruiterJobCategory,
  JOB_CATEGORY_CATALOG_QUERY_KEY,
} from "@/lib/job-category-catalog";

type Props = {
  value: string;
  onValueChange: (categoryId: string) => void;
  disabled?: boolean;
  catalog: JobCategoryRow[];
  catalogUnavailable?: boolean;
  allowCreate?: boolean;
};

export function JobCategorySelect({
  value,
  onValueChange,
  disabled,
  catalog,
  catalogUnavailable,
  allowCreate = true,
}: Props) {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const grouped = useMemo(() => groupCategoriesForPicker(catalog), [catalog]);

  const pickerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of [
      ...grouped.defaults,
      ...grouped.mine,
      ...grouped.global,
      ...grouped.inactiveAssigned,
    ]) {
      ids.add(row.id);
    }
    return ids;
  }, [grouped]);

  const effectiveValue = pickerIds.has(value) ? value : DEFAULT_JOB_CATEGORY_ID;

  const createCategory = useMutation({
    mutationFn: () => createRecruiterJobCategory(newName),
    onSuccess: async (row) => {
      toast.success("Category created");
      setCreateOpen(false);
      setNewName("");
      await qc.invalidateQueries({ queryKey: JOB_CATEGORY_CATALOG_QUERY_KEY });
      onValueChange(row.id);
    },
    onError: (e: Error) => toast.error("Could not create category", { description: e.message }),
  });

  if (catalogUnavailable) {
    return (
      <Select value={DEFAULT_JOB_CATEGORY_ID} disabled>
        <SelectTrigger>
          <SelectValue placeholder="Other (apply migration)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_JOB_CATEGORY_ID}>Other</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  return (
    <div className="flex gap-2">
      <Select
        value={effectiveValue}
        disabled={disabled}
        onValueChange={onValueChange}
      >
        <SelectTrigger className="min-w-0 flex-1">
          <SelectValue placeholder="Select category" />
        </SelectTrigger>
        <SelectContent>
          {grouped.defaults.length > 0 && (
            <SelectGroup>
              <SelectLabel>Defaults</SelectLabel>
              {grouped.defaults.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {grouped.mine.length > 0 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>My categories</SelectLabel>
                {grouped.mine.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
          {grouped.global.length > 0 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Organization</SelectLabel>
                {grouped.global.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
          {grouped.inactiveAssigned.length > 0 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Inactive (current job only)</SelectLabel>
                {grouped.inactiveAssigned.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} (inactive)
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
        </SelectContent>
      </Select>

      {allowCreate && !disabled && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" size="icon" aria-label="Create category">
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New private category</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="new-category-name">Name</Label>
              <Input
                id="new-category-name"
                value={newName}
                maxLength={80}
                placeholder="e.g. Legal Tech"
                onChange={(e) => setNewName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Visible only to you. Cannot duplicate default or global names.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="signal"
                disabled={createCategory.isPending || newName.trim().length < 1}
                onClick={() => createCategory.mutate()}
              >
                {createCategory.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
