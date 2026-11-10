import { isValidContactEmail, normalizeContactEmail } from "@/lib/crm/contacts";
import { canAccessCrmOwnedResource } from "@/lib/crm/ownership";
import { buildCrmContactSyncPayload } from "@/lib/crm/sync-from-application";
import type { CrmSegmentKind } from "@/lib/crm/types";

export type ApplicantImportRow = {
  seekerId: string;
  status: string;
  jobRecruiterId: string;
  jobCategory?: string | null;
};

export type SeekerProfileLite = {
  email: string | null;
  fullName: string | null;
  skillsText?: string | null;
};

export type PlannedCrmContactInsert = {
  recruiterId: string;
  seekerProfileId: string;
  email: string;
  emailNormalized: string;
  fullName: string | null;
  skills: string[];
  jobCategories: string[];
  applicationStatus: string;
  segmentKind: CrmSegmentKind;
};

export type PlanApplicantImportResult = {
  toInsert: PlannedCrmContactInsert[];
  toUpdate: PlannedCrmContactInsert[];
  imported: number;
  updated: number;
  skippedMissingEmail: number;
  skippedDuplicate: number;
  skippedUnauthorizedJob: number;
};

export function segmentKindFromApplicationStatus(status: string): CrmSegmentKind {
  if (status === "hired") return "placed";
  if (status === "applied") return "new";
  return "active";
}

/**
 * Pure planner: AuthZ filter + email/duplicate skips.
 * Caller must supply seeker profiles loaded only after ownership checks.
 * Duplicates become toUpdate (sync skills/status/category) rather than no-ops.
 */
export function planApplicantImport(input: {
  callerId: string;
  callerRole: string | null | undefined;
  applications: ApplicantImportRow[];
  profilesBySeekerId: Map<string, SeekerProfileLite>;
  /** Normalized emails already present for each owner recruiter_id. */
  existingEmailsByRecruiterId: Map<string, Set<string>>;
  /** Existing job_categories by recruiterId + emailNormalized. */
  existingCategoriesByRecruiterEmail?: Map<string, string[]>;
}): PlanApplicantImportResult {
  const toInsert: PlannedCrmContactInsert[] = [];
  const toUpdate: PlannedCrmContactInsert[] = [];
  let skippedMissingEmail = 0;
  let skippedDuplicate = 0;
  let skippedUnauthorizedJob = 0;
  const plannedByRecruiter = new Map<string, Set<string>>();

  for (const app of input.applications) {
    if (
      !canAccessCrmOwnedResource({
        ownerRecruiterId: app.jobRecruiterId,
        callerId: input.callerId,
        callerRole: input.callerRole,
      })
    ) {
      skippedUnauthorizedJob += 1;
      continue;
    }

    const ownerRecruiterId = app.jobRecruiterId;
    const profile = input.profilesBySeekerId.get(app.seekerId);
    const built = buildCrmContactSyncPayload(
      {
        recruiterId: ownerRecruiterId,
        seekerProfileId: app.seekerId,
        email: profile?.email ?? "",
        fullName: profile?.fullName ?? null,
        skillsText: profile?.skillsText ?? null,
        applicationStatus: app.status,
        jobCategory: app.jobCategory ?? null,
      },
      input.existingCategoriesByRecruiterEmail?.get(
        `${ownerRecruiterId}:${normalizeContactEmail(profile?.email ?? "")}`,
      ) ?? [],
    );
    if ("error" in built) {
      skippedMissingEmail += 1;
      continue;
    }
    if (!isValidContactEmail(built.email)) {
      skippedMissingEmail += 1;
      continue;
    }

    const planned = plannedByRecruiter.get(ownerRecruiterId) ?? new Set<string>();
    if (!plannedByRecruiter.has(ownerRecruiterId)) {
      plannedByRecruiter.set(ownerRecruiterId, planned);
    }

    const existing = input.existingEmailsByRecruiterId.get(ownerRecruiterId);
    const alreadyExisting = existing?.has(built.emailNormalized) === true;
    const alreadyPlanned = planned.has(built.emailNormalized);

    if (alreadyPlanned) {
      skippedDuplicate += 1;
      continue;
    }

    planned.add(built.emailNormalized);
    const row: PlannedCrmContactInsert = {
      recruiterId: built.recruiterId,
      seekerProfileId: built.seekerProfileId,
      email: built.email,
      emailNormalized: built.emailNormalized,
      fullName: built.fullName,
      skills: built.skills,
      jobCategories: built.jobCategories,
      applicationStatus: built.applicationStatus,
      segmentKind: built.segmentKind,
    };

    if (alreadyExisting) {
      toUpdate.push(row);
    } else {
      toInsert.push(row);
    }
  }

  return {
    toInsert,
    toUpdate,
    imported: toInsert.length,
    updated: toUpdate.length,
    skippedMissingEmail,
    skippedDuplicate,
    skippedUnauthorizedJob,
  };
}

export function summarizeApplicantImport(plan: PlanApplicantImportResult): {
  imported: number;
  updated: number;
  skipped: number;
} {
  return {
    imported: plan.imported,
    updated: plan.updated,
    skipped: plan.skippedMissingEmail + plan.skippedDuplicate + plan.skippedUnauthorizedJob,
  };
}
