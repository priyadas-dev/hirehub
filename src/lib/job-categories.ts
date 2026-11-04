/** System default job category labels (Assessment 3 Phase A hybrid catalog). */

export const JOB_CATEGORIES = [
  "IT",
  "Marketing",
  "Finance",
  "HR",
  "Sales",
  "Design",
  "Operations",
  "Other",
] as const;

export type DefaultJobCategory = (typeof JOB_CATEGORIES)[number];

export type JobCategoryScope = "default" | "recruiter" | "global";

export type JobCategoryRow = {
  id: string;
  scope: JobCategoryScope;
  owner_recruiter_id: string | null;
  name: string;
  name_normalized: string;
  active: boolean;
};

/** Stable UUIDs seeded in PROPOSED_0024 (must match migration). */
export const DEFAULT_JOB_CATEGORY_IDS: Record<DefaultJobCategory, string> = {
  IT: "00000000-0000-4000-8000-000000000001",
  Marketing: "00000000-0000-4000-8000-000000000002",
  Finance: "00000000-0000-4000-8000-000000000003",
  HR: "00000000-0000-4000-8000-000000000004",
  Sales: "00000000-0000-4000-8000-000000000005",
  Design: "00000000-0000-4000-8000-000000000006",
  Operations: "00000000-0000-4000-8000-000000000007",
  Other: "00000000-0000-4000-8000-000000000008",
};

export const DEFAULT_JOB_CATEGORY_ID = DEFAULT_JOB_CATEGORY_IDS.Other;

export const DEFAULT_JOB_CATEGORY_NAME: DefaultJobCategory = "Other";

export function isDefaultJobCategory(value: unknown): value is DefaultJobCategory {
  return typeof value === "string" && (JOB_CATEGORIES as readonly string[]).includes(value);
}

/** Legacy helper: map unknown label to a default name when needed. */
export function parseJobCategory(
  value: unknown,
  fallback: DefaultJobCategory = DEFAULT_JOB_CATEGORY_NAME,
): DefaultJobCategory {
  return isDefaultJobCategory(value) ? value : fallback;
}

export function normalizeCategoryLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Merge CRM job category labels (any catalog name), case-insensitive dedupe. */
export function mergeJobCategories(
  existing: string[] | null | undefined,
  next: string | null | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...(existing ?? []), ...(next ? [next] : [])]) {
    const label = normalizeCategoryLabel(raw);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

export function groupCategoriesForPicker(rows: JobCategoryRow[]): {
  defaults: JobCategoryRow[];
  mine: JobCategoryRow[];
  global: JobCategoryRow[];
  inactiveAssigned: JobCategoryRow[];
} {
  const defaults: JobCategoryRow[] = [];
  const mine: JobCategoryRow[] = [];
  const global: JobCategoryRow[] = [];
  const inactiveAssigned: JobCategoryRow[] = [];

  for (const row of rows) {
    if (!row.active && row.scope !== "default") {
      inactiveAssigned.push(row);
      continue;
    }
    if (row.scope === "default") defaults.push(row);
    else if (row.scope === "recruiter") mine.push(row);
    else if (row.scope === "global") global.push(row);
  }

  const byName = (a: JobCategoryRow, b: JobCategoryRow) => a.name.localeCompare(b.name);
  defaults.sort(byName);
  mine.sort(byName);
  global.sort(byName);
  inactiveAssigned.sort(byName);

  return { defaults, mine, global, inactiveAssigned };
}

export function categoryNameById(
  rows: JobCategoryRow[],
  id: string | null | undefined,
  fallback = DEFAULT_JOB_CATEGORY_NAME,
): string {
  if (!id) return fallback;
  return rows.find((r) => r.id === id)?.name ?? fallback;
}
