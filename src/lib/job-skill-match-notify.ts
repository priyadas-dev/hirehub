/**
 * Smart Job Matching Notification — pure helpers that mirror the proposed
 * SECURITY DEFINER trigger (PROPOSED_0012_job_skill_match_notifications.sql).
 *
 * Delivery is server-side only: clients must never INSERT into notifications
 * or scan other seekers' profiles.skills (RLS: own-or-admin).
 */

import { extractSkillsFromText } from "@/lib/ai/skill-extract";

export const JOB_SKILL_MATCH_TYPE = "job_skill_match" as const;

/** Documents that inserts happen only via notify_user + trigger — not the browser. */
export const JOB_SKILL_MATCH_DELIVERY = {
  clientMayInsert: false,
  clientMayListOtherSeekersSkills: false,
  deliveryPath: "security_definer_trigger" as const,
  notificationType: JOB_SKILL_MATCH_TYPE,
} as const;

export type JobSkillMatchJobFields = {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  salary_range?: string | null;
  job_type?: string | null;
  company_name?: string | null;
  status?: string | null;
};

export type SeekerSkillProfile = {
  id: string;
  role: string;
  skills: string | null | undefined;
};

export type JobSkillMatchNotificationDraft = {
  recipient_id: string;
  type: typeof JOB_SKILL_MATCH_TYPE;
  title: string;
  body: string;
  entity_type: "job";
  entity_id: string;
  link_path: string;
  dedupe_key: string;
  matchedSkills: string[];
};

/** True only when status newly becomes approved (pending→approved, closed→approved, etc.). */
export function isJobApprovedTransition(
  oldStatus: string | null | undefined,
  newStatus: string | null | undefined,
): boolean {
  if (newStatus !== "approved") return false;
  return oldStatus !== newStatus;
}

export function jobSkillMatchHaystack(job: JobSkillMatchJobFields): string {
  return [
    job.title,
    job.description,
    job.location,
    job.salary_range,
    job.job_type,
    job.company_name,
  ]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join("\n");
}

/**
 * Known skills that appear in both the seeker's profile skills text and the job
 * haystack. Empty when skills are missing or there is no overlap.
 */
export function matchedSkillsForApprovedJob(
  profileSkills: string | null | undefined,
  job: JobSkillMatchJobFields,
): string[] {
  if (typeof profileSkills !== "string" || !profileSkills.trim()) return [];
  const seekerSkills = extractSkillsFromText(profileSkills);
  if (!seekerSkills.length) return [];

  const jobSkills = extractSkillsFromText(jobSkillMatchHaystack(job));
  if (!jobSkills.length) return [];

  const jobLower = new Set(jobSkills.map((s) => s.toLowerCase()));
  return seekerSkills.filter((s) => jobLower.has(s.toLowerCase()));
}

export function jobSkillMatchDedupeKey(jobId: string, seekerId: string): string {
  return `job_skill_match:${jobId}:${seekerId}`;
}

export function buildJobSkillMatchNotification(input: {
  seekerId: string;
  job: JobSkillMatchJobFields;
  matchedSkills: string[];
}): JobSkillMatchNotificationDraft | null {
  const matched = input.matchedSkills.filter(Boolean);
  if (!matched.length) return null;

  const title = input.job.title?.trim() || "a job";
  const top = matched.slice(0, 3);
  const skillPhrase =
    top.length === 1
      ? top[0]
      : top.length === 2
        ? `${top[0]} and ${top[1]}`
        : `${top[0]}, ${top[1]}, and ${top[2]}`;
  const more = matched.length > 3 ? " (+more)" : "";

  return {
    recipient_id: input.seekerId,
    type: JOB_SKILL_MATCH_TYPE,
    title: "New job matches your skills",
    body: `${title} was approved and matches your ${skillPhrase}${more} skills.`,
    entity_type: "job",
    entity_id: input.job.id,
    link_path: `/seeker/jobs/${input.job.id}`,
    dedupe_key: jobSkillMatchDedupeKey(input.job.id, input.seekerId),
    matchedSkills: matched,
  };
}

/** Only job seekers with non-blank skills are candidates (never recruiters/admins). */
export function isEligibleSkillMatchSeeker(profile: SeekerSkillProfile): boolean {
  if (profile.role !== "job_seeker") return false;
  return typeof profile.skills === "string" && profile.skills.trim().length > 0;
}

/**
 * Plan in-app notifications for an approval transition.
 * Returns [] when not an approval transition, job missing, or no skill overlaps.
 * Idempotent drafts share stable dedupe keys (DB ON CONFLICT DO NOTHING).
 */
export function planJobSkillMatchNotifications(input: {
  oldStatus: string | null | undefined;
  newStatus: string | null | undefined;
  job: JobSkillMatchJobFields | null | undefined;
  seekers: SeekerSkillProfile[];
}): JobSkillMatchNotificationDraft[] {
  if (!input.job?.id) return [];
  if (!isJobApprovedTransition(input.oldStatus, input.newStatus)) return [];

  const drafts: JobSkillMatchNotificationDraft[] = [];
  const seenSeekers = new Set<string>();

  for (const seeker of input.seekers) {
    if (!isEligibleSkillMatchSeeker(seeker)) continue;
    if (seenSeekers.has(seeker.id)) continue;
    seenSeekers.add(seeker.id);

    const matchedSkills = matchedSkillsForApprovedJob(seeker.skills, input.job);
    const draft = buildJobSkillMatchNotification({
      seekerId: seeker.id,
      job: input.job,
      matchedSkills,
    });
    if (draft) drafts.push(draft);
  }

  return drafts;
}

/**
 * Simulate repeated approval delivery using the same dedupe keys as the DB.
 * Second pass yields no new keys — mirrors ON CONFLICT (recipient_id, dedupe_key) DO NOTHING.
 */
export function dedupeJobSkillMatchDrafts(
  existingKeys: Iterable<string>,
  drafts: JobSkillMatchNotificationDraft[],
): JobSkillMatchNotificationDraft[] {
  const seen = new Set(existingKeys);
  const unique: JobSkillMatchNotificationDraft[] = [];
  for (const draft of drafts) {
    if (seen.has(draft.dedupe_key)) continue;
    seen.add(draft.dedupe_key);
    unique.push(draft);
  }
  return unique;
}
