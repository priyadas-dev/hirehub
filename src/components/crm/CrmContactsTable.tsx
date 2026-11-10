import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { STATUS_META, type ApplicationStatus } from "@/components/status/status";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { crmContactSource } from "@/lib/crm/contacts-list";
import type { CrmContactSortDir, CrmContactSortField } from "@/lib/crm/contacts-list";
import type { CrmContact } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

type Props = {
  contacts: CrmContact[];
  sortBy: CrmContactSortField;
  sortDir: CrmContactSortDir;
  onSort: (field: CrmContactSortField) => void;
  selectedIds: Set<string>;
  onToggleOne: (id: string, checked: boolean) => void;
  onTogglePage: (checked: boolean) => void;
  pageAllSelected: boolean;
  pageSomeSelected: boolean;
  onRowClick: (contact: CrmContact) => void;
};

function SortIcon({ active, dir }: { active: boolean; dir: CrmContactSortDir }) {
  if (!active) return <ArrowUpDown className="ml-1 inline size-3.5 opacity-40" />;
  return dir === "asc" ? (
    <ArrowUp className="ml-1 inline size-3.5" />
  ) : (
    <ArrowDown className="ml-1 inline size-3.5" />
  );
}

function SortableHead({
  label,
  field,
  sortBy,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  field: CrmContactSortField;
  sortBy: CrmContactSortField;
  sortDir: CrmContactSortDir;
  onSort: (field: CrmContactSortField) => void;
  className?: string;
}) {
  return (
    <TableHead className={className}>
      <button
        type="button"
        className="inline-flex items-center font-medium hover:text-foreground"
        onClick={() => onSort(field)}
      >
        {label}
        <SortIcon active={sortBy === field} dir={sortDir} />
      </button>
    </TableHead>
  );
}

export function CrmContactsTable({
  contacts,
  sortBy,
  sortDir,
  onSort,
  selectedIds,
  onToggleOne,
  onTogglePage,
  pageAllSelected,
  pageSomeSelected,
  onRowClick,
}: Props) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={pageAllSelected ? true : pageSomeSelected ? "indeterminate" : false}
                onCheckedChange={(v) => onTogglePage(v === true)}
                aria-label="Select all on this page"
              />
            </TableHead>
            <SortableHead label="Name" field="name" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <SortableHead label="Email" field="email" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <TableHead>Skills</TableHead>
            <TableHead>Job categories</TableHead>
            <SortableHead
              label="Status"
              field="applicationStatus"
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortableHead label="Kind" field="segmentKind" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <TableHead>Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((c) => {
            const statusMeta =
              c.applicationStatus && c.applicationStatus in STATUS_META
                ? STATUS_META[c.applicationStatus as ApplicationStatus]
                : null;
            const source = crmContactSource(c);
            return (
              <TableRow
                key={c.id}
                className="cursor-pointer"
                data-state={selectedIds.has(c.id) ? "selected" : undefined}
                onClick={() => onRowClick(c)}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selectedIds.has(c.id)}
                    onCheckedChange={(v) => onToggleOne(c.id, v === true)}
                    aria-label={`Select ${c.fullName || c.email}`}
                  />
                </TableCell>
                <TableCell className="font-medium">{c.fullName || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{c.email}</TableCell>
                <TableCell className="max-w-[160px] truncate text-xs" title={c.skills.join(", ")}>
                  {c.skills.length ? c.skills.join(", ") : "—"}
                </TableCell>
                <TableCell className="max-w-[140px] truncate text-xs" title={c.jobCategories.join(", ")}>
                  {c.jobCategories.length ? c.jobCategories.join(", ") : "—"}
                </TableCell>
                <TableCell>
                  {statusMeta ? (
                    <span className={cn("text-xs font-medium", statusMeta.text)}>{statusMeta.label}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs capitalize">{c.segmentKind}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {source === "import" ? "Applicants" : "Manual"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
