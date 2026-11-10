/**
 * Resume Storage SELECT authorization mirror of PROPOSED_0008 policy
 * `resumes_select_owner_admin_or_hiring_recruiter` on storage.objects.
 *
 * Live enforcement remains in Postgres Storage policies (private `resumes` bucket).
 * This module mirrors those rules for unit tests and **authorize-before-sign** gating
 * so a signed URL is never requested when the policy mirror would deny.
 *
 * Never make the bucket public. Never trust client-supplied seeker/recruiter ids
 * for ownership — callers must pass auth.uid() / JWT-derived role and DB-backed links.
 */

import { storageFirstFolder, storagePathIsSafe } from "@/lib/hirehub-storage";

export type ResumeAccessRole = "job_seeker" | "recruiter" | "admin" | string;

/** Minimal application+job join facts needed to evaluate hiring-recruiter access. */
export type ResumeAccessApplicationLink = {
  seekerId: string;
  resumeStoragePath: string;
  /** jobs.recruiter_id for the application’s job */
  jobRecruiterId: string;
};

export type ResumeStorageSelectInput = {
  /** auth.uid() — empty / missing means unauthenticated */
  authUserId: string | null | undefined;
  /** profiles.role */
  role: ResumeAccessRole | null | undefined;
  /** storage.objects.name */
  objectName: string;
  /** Applications that reference this object path (exact match), with job owner */
  applicationLinks: ResumeAccessApplicationLink[];
};

export type ResumeStorageSelectDecision =
  | { allowed: true; reason: "owner" | "admin" | "hiring_recruiter" }
  | { allowed: false; reason: "unauthenticated" | "unsafe_path" | "denied" };

/**
 * Mirrors:
 *   bucket resumes AND storage_path_is_safe(name) AND (
 *     first_folder = auth.uid OR admin OR EXISTS hiring recruiter match on applications
 *   )
 * Storage SELECT policy is `TO authenticated` only — anon has no grant.
 */
export function evaluateResumeStorageSelectAccess(
  input: ResumeStorageSelectInput,
): ResumeStorageSelectDecision {
  const authUserId = input.authUserId?.trim() ?? "";
  if (!authUserId) {
    return { allowed: false, reason: "unauthenticated" };
  }

  const objectName = input.objectName.trim();
  if (!storagePathIsSafe(objectName)) {
    return { allowed: false, reason: "unsafe_path" };
  }

  const folder = storageFirstFolder(objectName);
  if (!folder) return { allowed: false, reason: "unsafe_path" };

  if (folder === authUserId) {
    return { allowed: true, reason: "owner" };
  }

  if (input.role === "admin") {
    return { allowed: true, reason: "admin" };
  }

  const hiringMatch = input.applicationLinks.some((link) => {
    if (!link.resumeStoragePath || link.resumeStoragePath !== objectName) return false;
    if (link.jobRecruiterId !== authUserId) return false;
    if (link.seekerId !== folder) return false;
    const pathFolder = storageFirstFolder(link.resumeStoragePath);
    return pathFolder === link.seekerId;
  });

  if (hiringMatch) {
    return { allowed: true, reason: "hiring_recruiter" };
  }

  return { allowed: false, reason: "denied" };
}

/** Convenience: another recruiter (not job owner) must be denied. */
export function otherRecruiterResumeAccessDenied(input: {
  objectName: string;
  seekerId: string;
  hiringRecruiterId: string;
  otherRecruiterId: string;
}): boolean {
  const decision = evaluateResumeStorageSelectAccess({
    authUserId: input.otherRecruiterId,
    role: "recruiter",
    objectName: input.objectName,
    applicationLinks: [
      {
        seekerId: input.seekerId,
        resumeStoragePath: input.objectName,
        jobRecruiterId: input.hiringRecruiterId,
      },
    ],
  });
  return decision.allowed === false && decision.reason === "denied";
}

export type IssueResumeSignedUrlResult =
  | { ok: true; signedUrl: string; reason: "owner" | "admin" | "hiring_recruiter" }
  | {
      ok: false;
      reason: "unauthenticated" | "unsafe_path" | "denied";
      /** True when createSignedUrl was never invoked */
      signedUrlAttempted: false;
    };

/**
 * Defense-in-depth: evaluate Storage SELECT rules **before** minting a signed URL.
 * Live Supabase also enforces policies on `createSignedUrl` for the caller's JWT;
 * this ensures app code never asks for a URL when authorization already fails.
 */
export async function issueResumeSignedUrlAfterAuthorization(
  input: ResumeStorageSelectInput & {
    expiresInSeconds: number;
    createSignedUrl: (objectName: string, expiresInSeconds: number) => Promise<string>;
  },
): Promise<IssueResumeSignedUrlResult> {
  const decision = evaluateResumeStorageSelectAccess(input);
  if (!decision.allowed) {
    return { ok: false, reason: decision.reason, signedUrlAttempted: false };
  }

  const signedUrl = await input.createSignedUrl(input.objectName.trim(), input.expiresInSeconds);
  return { ok: true, signedUrl, reason: decision.reason };
}
