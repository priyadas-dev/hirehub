import { extractSkillsFromText } from "@/lib/ai/skill-extract";
import { normalizeContactEmail, isValidContactEmail } from "@/lib/crm/contacts";
import { segmentKindFromApplicationStatus } from "@/lib/crm/import-from-applicants";
import {
  DEFAULT_JOB_CATEGORY_NAME,
  mergeJobCategories,
  normalizeCategoryLabel,
} from "@/lib/job-categories";
import type { CrmSegmentKind } from "@/lib/crm/types";

export type CrmSyncSnapshot = {
  recruiterId: string;
  seekerProfileId: string;
  email: string;
  fullName: string | null;
  skillsText: string | null;
  applicationStatus: string;
  jobCategory: string | null;
};

export type CrmContactSyncPayload = {
  recruiterId: string;
  seekerProfileId: string;
  email: string;
  emailNormalized: string;
  fullName: string | null;
  skills: string[];
  applicationStatus: string;
  segmentKind: CrmSegmentKind;
  jobCategories: string[];
};

export function parseProfileSkillsText(skillsText: string | null | undefined): string[] {
  if (!skillsText?.trim()) return [];
  return extractSkillsFromText(skillsText);
}

export function buildCrmContactSyncPayload(
  snapshot: CrmSyncSnapshot,
  existingJobCategories: string[] = [],
): CrmContactSyncPayload | { error: string } {
  const email = snapshot.email?.trim() || "";
  if (!isValidContactEmail(email)) return { error: "missing_email" };
  if (!snapshot.recruiterId) return { error: "missing_recruiter" };
  if (!snapshot.seekerProfileId) return { error: "missing_seeker" };

  const category = normalizeCategoryLabel(snapshot.jobCategory) ?? DEFAULT_JOB_CATEGORY_NAME;
  return {
    recruiterId: snapshot.recruiterId,
    seekerProfileId: snapshot.seekerProfileId,
    email,
    emailNormalized: normalizeContactEmail(email),
    fullName: snapshot.fullName?.trim() || null,
    skills: parseProfileSkillsText(snapshot.skillsText),
    applicationStatus: snapshot.applicationStatus,
    segmentKind: segmentKindFromApplicationStatus(snapshot.applicationStatus),
    jobCategories: mergeJobCategories(existingJobCategories, category),
  };
}
