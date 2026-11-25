/**
 * Recruiter applicant / resume authorization — JWT + DB job ownership only.
 * Never trusts body-supplied recruiter ids. Forbidden responses must not leak PII.
 */

import { isAuthorizedApplicationNotifier } from "@/lib/application-notifier-authz";

/** Consistent Access Denied copy for unauthorized resume / applicant asks. */
export const RECRUITER_RESUME_ACCESS_DENIED_MESSAGE =
  "I'm sorry, but you don't have permission to access this applicant's resume. You can only access applicants who applied to your jobs.";

export const RECRUITER_APPLICANT_ACCESS_DENIED_MESSAGE =
  "I'm sorry, but you don't have permission to access this applicant. You can only access applicants who applied to your jobs.";

export type OwnedApplicationFacts = {
  applicationId: string;
  jobId: string;
  seekerId: string;
  jobRecruiterId: string;
  status?: string | null;
  seekerName?: string | null;
  seekerEmail?: string | null;
  coverNote?: string | null;
  resumeStoragePath?: string | null;
  resumeFileName?: string | null;
  skills?: string[] | null;
};

export type ApplicantAccessDecision =
  | { allowed: true; application: OwnedApplicationFacts }
  | { allowed: false; code: "forbidden"; message: string };

/**
 * Authorize access to an application row for recruiter tools.
 * Uses callerId / callerRole from JWT session + jobRecruiterId from DB.
 */
export function authorizeRecruiterApplicationAccess(input: {
  callerId: string;
  callerRole: string | null | undefined;
  application: OwnedApplicationFacts | null | undefined;
  /** When true, use resume-specific deny copy. */
  resumeContext?: boolean;
}): ApplicantAccessDecision {
  if (!input.application?.applicationId || !input.application.jobRecruiterId) {
    return {
      allowed: false,
      code: "forbidden",
      message: input.resumeContext
        ? RECRUITER_RESUME_ACCESS_DENIED_MESSAGE
        : RECRUITER_APPLICANT_ACCESS_DENIED_MESSAGE,
    };
  }

  if (
    !isAuthorizedApplicationNotifier({
      callerId: input.callerId,
      callerRole: input.callerRole,
      jobRecruiterId: input.application.jobRecruiterId,
    })
  ) {
    return {
      allowed: false,
      code: "forbidden",
      message: input.resumeContext
        ? RECRUITER_RESUME_ACCESS_DENIED_MESSAGE
        : RECRUITER_APPLICANT_ACCESS_DENIED_MESSAGE,
    };
  }

  return { allowed: true, application: input.application };
}

/** Strip PII from unauthorized outcomes — message only, never echo names/emails. */
export function forbiddenApplicantReply(resumeContext = false): {
  ok: false;
  code: "forbidden";
  message: string;
} {
  return {
    ok: false,
    code: "forbidden",
    message: resumeContext
      ? RECRUITER_RESUME_ACCESS_DENIED_MESSAGE
      : RECRUITER_APPLICANT_ACCESS_DENIED_MESSAGE,
  };
}

/**
 * Prompt-injection / cross-tenant probe heuristics.
 * When true, force ownership check before any applicant data is returned.
 */
export function looksLikeCrossRecruiterAccessProbe(question: string): boolean {
  const q = question.trim();
  return (
    /\b(ignore|bypass|override)\b[\s\S]{0,40}\b(permission|auth|rls|owner|access)\b/i.test(q) ||
    /\b(as\s+admin|act\s+as\s+admin|pretend\s+you\s+are\s+admin)\b/i.test(q) ||
    /\b(another|other|different)\s+recruiter('?s)?\s+(applicant|resume|candidate)\b/i.test(q) ||
    /\b(all\s+recruiters?|every\s+recruiter|cross[- ]tenant)\b/i.test(q)
  );
}

export function looksLikeResumeAccessQuestion(question: string): boolean {
  return /\b(resume|cv|curriculum\s+vitae)\b/i.test(question);
}

export function looksLikeApplicantQaIntent(question: string): boolean {
  const q = question.trim();
  if (looksLikeResumeAccessQuestion(q)) return true;
  if (/\b(compare|comparison|versus|vs\.?)\b/i.test(q) && /\b(applicant|candidate|shortlist)/i.test(q)) {
    return true;
  }
  if (
    /\b(skill|skills|experience|experienced|years?|summarize|summary|background|machine\s+learning|\.net|react|node\.?js|python|typescript)\b/i.test(
      q,
    ) &&
    /\b(applicant|candidate|resume|cv|they|them|this\s+one|selected)\b/i.test(q)
  ) {
    return true;
  }
  if (/\b(top\s+\d+|best\s+\d+)\b[\s\S]{0,40}\b(applicant|candidate)s?\b/i.test(q)) return true;
  if (/\b(which|who|does|do)\b[\s\S]{0,80}\b(applicant|candidate)s?\b/i.test(q)) return true;
  if (/\bfind\s+applicants?\b/i.test(q)) return true;
  return false;
}
