/**
 * Idempotent job application helper (Assessment 3 Phase 1 / hard problem 1).
 *
 * Relies on DB `UNIQUE (job_id, seeker_id)`. Concurrent inserts that race past
 * the pre-check still collapse to one row via Postgres 23505 handling.
 * Callers must use the signed-in seeker's JWT client — never service role.
 */

export type ApplyJobSnapshot = {
  id: string;
  status: string;
  application_deadline?: string | null;
  description?: string | null;
};

export type ApplyToJobRow = {
  job_id: string;
  seeker_id: string;
  resume_storage_path?: string | null;
  resume_file_name?: string | null;
  resume_url?: string | null;
  portfolio_url?: string | null;
  cover_note?: string | null;
};

export type ApplyToJobClient = {
  findApprovedJob: (jobId: string) => Promise<{ data: ApplyJobSnapshot | null; error: { message: string } | null }>;
  findExistingApplication: (
    jobId: string,
    seekerId: string,
  ) => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
  insertApplication: (
    row: ApplyToJobRow,
  ) => Promise<{ data: { id: string } | null; error: { code?: string; message: string } | null }>;
  /** Optional: sync seeker identity onto profiles before insert (own row via JWT RLS). */
  updateSeekerProfile?: (input: {
    seekerId: string;
    fullName: string;
    email: string;
  }) => Promise<{ error: { message: string } | null }>;
};

export type ApplyToJobInput = {
  jobId: string;
  seekerId: string;
  /** Required applicant identity shown to recruiters. */
  fullName: string;
  /** Required contact email (stored on profiles; not Auth email change). */
  email: string;
  /** When true, require storage path or legacy URL and prefer storage columns. */
  canPersistStorage: boolean;
  resumeStoragePath?: string | null;
  resumeFileName?: string | null;
  resumeUrl?: string | null;
  portfolioUrl?: string | null;
  /** Required "About you" text; persisted as applications.cover_note. */
  coverNote: string;
  /** Injected deadline check so routes keep using job-fields helpers. */
  isDeadlinePassed: (job: ApplyJobSnapshot) => boolean;
  /** Optional path safety (storage). */
  assertResumeStoragePath?: (path: string, seekerId: string) => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateApplicantBasics(input: {
  fullName?: string | null;
  email?: string | null;
  aboutYou?: string | null;
}): { ok: true; fullName: string; email: string; aboutYou: string } | { ok: false; message: string } {
  const fullName = input.fullName?.trim() ?? "";
  const email = input.email?.trim() ?? "";
  const aboutYou = input.aboutYou?.trim() ?? "";
  if (fullName.length < 2) {
    return { ok: false, message: "Enter your name (at least 2 characters)." };
  }
  if (!EMAIL_RE.test(email)) {
    return { ok: false, message: "Enter a valid email address." };
  }
  if (aboutYou.length < 10) {
    return { ok: false, message: "About you must be at least 10 characters." };
  }
  return { ok: true, fullName, email, aboutYou };
}

export type ApplyToJobResult =
  | { ok: true; status: "created" | "already_applied"; applicationId: string }
  | { ok: false; code: "unauthorized" | "unavailable" | "deadline" | "validation" | "db"; message: string };

export function isUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  return /duplicate|unique/i.test(error.message ?? "");
}

/**
 * Apply once per (job_id, seeker_id). Safe under concurrent retries:
 * pre-check + UNIQUE + 23505 → fetch existing id.
 */
export async function applyToJob(
  client: ApplyToJobClient,
  input: ApplyToJobInput,
): Promise<ApplyToJobResult> {
  const seekerId = input.seekerId.trim();
  const jobId = input.jobId.trim();
  if (!seekerId || !jobId) {
    return { ok: false, code: "unauthorized", message: "Not signed in" };
  }

  const live = await client.findApprovedJob(jobId);
  if (live.error) return { ok: false, code: "db", message: live.error.message };
  if (!live.data) {
    return { ok: false, code: "unavailable", message: "This job is no longer available." };
  }
  if (input.isDeadlinePassed(live.data)) {
    return {
      ok: false,
      code: "deadline",
      message: "The application deadline for this job has passed.",
    };
  }

  const existing = await client.findExistingApplication(jobId, seekerId);
  if (existing.error) return { ok: false, code: "db", message: existing.error.message };
  if (existing.data) {
    return { ok: true, status: "already_applied", applicationId: existing.data.id };
  }

  const basics = validateApplicantBasics({
    fullName: input.fullName,
    email: input.email,
    aboutYou: input.coverNote,
  });
  if (!basics.ok) {
    return { ok: false, code: "validation", message: basics.message };
  }

  if (client.updateSeekerProfile) {
    const profileUpdate = await client.updateSeekerProfile({
      seekerId,
      fullName: basics.fullName,
      email: basics.email,
    });
    if (profileUpdate.error) {
      return { ok: false, code: "db", message: profileUpdate.error.message };
    }
  }

  const storagePath = input.resumeStoragePath?.trim() || null;
  const legacyResume = input.resumeUrl?.trim() || null;
  const fileName = input.resumeFileName?.trim() || null;
  const portfolioUrl = input.portfolioUrl?.trim() || null;
  const coverNote = basics.aboutYou;

  let row: ApplyToJobRow;

  if (input.canPersistStorage) {
    if (!storagePath && !legacyResume) {
      return {
        ok: false,
        code: "validation",
        message: "Upload a resume PDF or provide a resume URL.",
      };
    }
    if (storagePath) {
      try {
        input.assertResumeStoragePath?.(storagePath, seekerId);
      } catch (e) {
        return {
          ok: false,
          code: "validation",
          message: e instanceof Error ? e.message : "Invalid resume Storage path.",
        };
      }
    }
    if (legacyResume && !storagePath && !/^https?:\/\/\S+/i.test(legacyResume)) {
      return {
        ok: false,
        code: "validation",
        message: "Resume must be a full URL starting with http:// or https://",
      };
    }
    row = {
      job_id: jobId,
      seeker_id: seekerId,
      resume_storage_path: storagePath,
      resume_file_name: storagePath ? fileName : null,
      resume_url: storagePath ? null : legacyResume,
      portfolio_url: portfolioUrl,
      cover_note: coverNote,
    };
  } else {
    if (!legacyResume) {
      return {
        ok: false,
        code: "validation",
        message: "Resume URL is required until PDF upload storage is available",
      };
    }
    if (!/^https?:\/\/\S+/i.test(legacyResume)) {
      return {
        ok: false,
        code: "validation",
        message: "Resume must be a full URL starting with http:// or https://",
      };
    }
    row = {
      job_id: jobId,
      seeker_id: seekerId,
      resume_url: legacyResume,
      cover_note: coverNote,
    };
  }

  const inserted = await client.insertApplication(row);
  if (!inserted.error && inserted.data?.id) {
    return { ok: true, status: "created", applicationId: inserted.data.id };
  }

  if (isUniqueViolation(inserted.error)) {
    const again = await client.findExistingApplication(jobId, seekerId);
    if (again.data?.id) {
      return { ok: true, status: "already_applied", applicationId: again.data.id };
    }
    return {
      ok: false,
      code: "db",
      message: inserted.error?.message || "Already applied",
    };
  }

  return {
    ok: false,
    code: "db",
    message: inserted.error?.message || "Could not apply",
  };
}
