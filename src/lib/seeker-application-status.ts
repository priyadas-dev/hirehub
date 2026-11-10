/**
 * Seeker application status reads for the Application Agent.
 * Always scoped to the authenticated seeker id — never trust seeker id from user input.
 */

export type SeekerApplicationStatusRow = {
  id: string;
  status: string;
  createdAt: string;
  jobId: string;
  jobTitle: string;
  companyName: string | null;
  location: string | null;
};

export type SeekerApplicationStatusClient = {
  /**
   * Page of applications for one seeker. Always filter by seekerId in the adapter.
   * Use offset/pageSize for list mode; specific id lookups use pageSize as a cap.
   */
  listForSeeker: (input: {
    seekerId: string;
    jobId?: string;
    applicationId?: string;
    pageSize: number;
    offset: number;
  }) => Promise<{ data: SeekerApplicationStatusRow[]; error: { message: string } | null }>;
};

export type CheckSeekerApplicationStatusInput = {
  seekerId: string;
  jobId?: string;
  applicationId?: string;
};

export type CheckSeekerApplicationStatusResult =
  | { ok: true; applications: SeekerApplicationStatusRow[] }
  | { ok: false; code: "unauthorized" | "validation" | "db"; message: string };

/** Batch size for full-list pagination (keeps each DB response bounded). */
export const SEEKER_STATUS_PAGE_SIZE = 50;

/**
 * Soft ceiling so a pathological account cannot pull unbounded rows in one turn.
 * Real seeker volumes stay well below this; pagination still returns every page under the cap.
 */
export const SEEKER_STATUS_MAX_ROWS = 500;

/**
 * List or look up applications belonging only to `seekerId`.
 * - With applicationId or jobId: returns matching owned row(s) only.
 * - Without: pages through all of the seeker's applications (no fixed "latest 10" cut-off).
 * Passing another seeker's application id returns an empty list (no leak).
 */
export async function checkSeekerApplicationStatus(
  client: SeekerApplicationStatusClient,
  input: CheckSeekerApplicationStatusInput,
): Promise<CheckSeekerApplicationStatusResult> {
  const seekerId = input.seekerId.trim();
  if (!seekerId) {
    return {
      ok: false,
      code: "unauthorized",
      message: "Sign in as a job seeker to check application status.",
    };
  }

  const applicationId = input.applicationId?.trim() || undefined;
  const jobId = input.jobId?.trim() || undefined;

  // Specific lookup — small, precise query (UNIQUE job+seeker ⇒ at most one for jobId).
  if (applicationId || jobId) {
    const listed = await client.listForSeeker({
      seekerId,
      jobId,
      applicationId,
      pageSize: applicationId ? 1 : 5,
      offset: 0,
    });
    if (listed.error) return { ok: false, code: "db", message: listed.error.message };
    return { ok: true, applications: listed.data };
  }

  // Full list — page until exhausted (or soft safety ceiling).
  const applications: SeekerApplicationStatusRow[] = [];
  let offset = 0;

  while (offset < SEEKER_STATUS_MAX_ROWS) {
    const pageSize = Math.min(SEEKER_STATUS_PAGE_SIZE, SEEKER_STATUS_MAX_ROWS - offset);
    const page = await client.listForSeeker({
      seekerId,
      pageSize,
      offset,
    });
    if (page.error) return { ok: false, code: "db", message: page.error.message };

    applications.push(...page.data);
    if (page.data.length < pageSize) break;
    offset += page.data.length;
  }

  return { ok: true, applications };
}
