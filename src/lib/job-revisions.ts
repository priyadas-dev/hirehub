import type { JobType } from "@/lib/hirehub";

export type JobContentFields = {
  title: string;
  description: string | null;
  location: string | null;
  salary_range: string | null;
  job_type: JobType;
  application_deadline: string | null;
  jobCategoryId: string;
  categoryName: string;
};

export type JobFieldKey = keyof JobContentFields;

export const JOB_CONTENT_FIELD_LABELS: Record<JobFieldKey, string> = {
  title: "Title",
  description: "Description",
  location: "Location",
  salary_range: "Salary",
  job_type: "Job type",
  application_deadline: "Application deadline",
  jobCategoryId: "Category",
  categoryName: "Category",
};

export type FieldDiff = {
  field: JobFieldKey;
  label: string;
  before: string;
  after: string;
};

function display(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return value;
}

export function normalizeJobContent(input: JobContentFields): JobContentFields {
  return {
    title: input.title.trim(),
    description: input.description?.trim() || null,
    location: input.location?.trim() || null,
    salary_range: input.salary_range?.trim() || null,
    job_type: input.job_type,
    application_deadline: input.application_deadline?.trim() || null,
    jobCategoryId: input.jobCategoryId,
    categoryName: input.categoryName,
  };
}

/** True when proposed content differs from the live approved job. */
export function jobContentChanged(live: JobContentFields, proposed: JobContentFields): boolean {
  const a = normalizeJobContent(live);
  const b = normalizeJobContent(proposed);
  return (Object.keys(a) as JobFieldKey[]).some((k) => {
    if (k === "categoryName") return false;
    return a[k] !== b[k];
  });
}

/** Before/after rows for admin comparison UI. */
export function diffJobContent(baseline: JobContentFields, proposed: JobContentFields): FieldDiff[] {
  const before = normalizeJobContent(baseline);
  const after = normalizeJobContent(proposed);
  const diffs: FieldDiff[] = [];
  for (const field of Object.keys(before) as JobFieldKey[]) {
    if (field === "categoryName") continue;
    if (field === "jobCategoryId") {
      if (before.jobCategoryId === after.jobCategoryId) continue;
      diffs.push({
        field,
        label: JOB_CONTENT_FIELD_LABELS[field],
        before: display(before.categoryName),
        after: display(after.categoryName),
      });
      continue;
    }
    if (before[field] === after[field]) continue;
    diffs.push({
      field,
      label: JOB_CONTENT_FIELD_LABELS[field],
      before: display(before[field]),
      after: display(after[field]),
    });
  }
  return diffs;
}

/**
 * Recruiter may submit a revision only for an approved live job with no open pending revision.
 * Pending/rejected/closed jobs use different flows (direct edit or none).
 */
export function canSubmitJobRevision(input: {
  jobStatus: string;
  hasPendingRevision: boolean;
  isOwner: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.isOwner) return { ok: false, reason: "Only the owning recruiter can submit revisions." };
  if (input.jobStatus !== "approved") {
    return { ok: false, reason: "Only approved jobs use the revision workflow." };
  }
  if (input.hasPendingRevision) {
    return { ok: false, reason: "A revision is already pending admin review." };
  }
  return { ok: true };
}

/** Direct live UPDATE is allowed for pending jobs owned by the recruiter (first-approval flow). */
export function canDirectEditLiveJob(jobStatus: string): boolean {
  return jobStatus === "pending";
}

export function revisionReviewLink(revisionId: string): string {
  return `/admin/job-revisions?id=${revisionId}`;
}
