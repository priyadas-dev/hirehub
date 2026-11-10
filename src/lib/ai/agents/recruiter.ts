/**
 * Recruiter agent (Phase 7) — shortlist / draft outreach under job+CRM ownership.
 * Never trusts body-supplied recruiterId/role. Does not send campaigns without confirm.
 */

import type { ApplicationStatus } from "@/components/status/status";
import { isAuthorizedApplicationNotifier } from "@/lib/notify-application-status";
import { canAccessCrmOwnedResource } from "@/lib/crm/ownership";
import {
  buildCampaignPreview,
  createCampaignRecord,
  type PrepareCampaignSendResult,
  prepareCampaignSend,
} from "@/lib/crm/campaigns";
import type { CrmCampaign, CrmContact, CrmSegment } from "@/lib/crm/types";

export type RecruiterOwnedJob = {
  id: string;
  title: string;
  recruiterId: string;
  companyId?: string | null;
};

export type RecruiterApplicationRow = {
  id: string;
  jobId: string;
  seekerId: string;
  status: ApplicationStatus;
  jobRecruiterId: string;
  seekerName?: string | null;
  seekerEmail?: string | null;
};

export type RecruiterAgentDeps = {
  callerId: string;
  callerRole: string | null | undefined;
};

export type ShortlistInput = {
  application: RecruiterApplicationRow;
  /** Target status — default shortlisted */
  status?: Extract<ApplicationStatus, "shortlisted" | "interview" | "rejected" | "hired">;
  confirm: boolean;
};

export type ShortlistResult =
  | {
      ok: true;
      status: "needs_confirm";
      message: string;
      plannedStatus: ApplicationStatus;
      applicationId: string;
    }
  | {
      ok: true;
      status: "authorized";
      message: string;
      applicationId: string;
      plannedStatus: ApplicationStatus;
      /** Caller must persist via existing notify helper — agent only authorizes. */
      authorized: true;
    }
  | { ok: false; code: "forbidden" | "validation"; message: string };

/**
 * Authorize shortlist/status change for an application on an owned job.
 * Persistence stays in `updateApplicationStatusWithNotification` (JWT).
 */
export function planRecruiterShortlist(
  input: ShortlistInput,
  deps: RecruiterAgentDeps,
): ShortlistResult {
  const status = input.status ?? "shortlisted";
  if (!input.application?.id || !input.application.jobRecruiterId) {
    return { ok: false, code: "validation", message: "Application and job owner are required." };
  }

  if (
    !isAuthorizedApplicationNotifier({
      callerId: deps.callerId,
      callerRole: deps.callerRole,
      jobRecruiterId: input.application.jobRecruiterId,
    })
  ) {
    return {
      ok: false,
      code: "forbidden",
      message: "You can only shortlist applicants for jobs you own.",
    };
  }

  if (!input.confirm) {
    return {
      ok: true,
      status: "needs_confirm",
      applicationId: input.application.id,
      plannedStatus: status,
      message: `Confirm to mark this applicant as ${status}. No status change until you confirm.`,
    };
  }

  return {
    ok: true,
    status: "authorized",
    authorized: true,
    applicationId: input.application.id,
    plannedStatus: status,
    message: `Authorized to set application ${input.application.id} to ${status}.`,
  };
}

export type DraftOutreachInput = {
  job: RecruiterOwnedJob;
  contact?: Pick<CrmContact, "id" | "recruiterId" | "email" | "fullName"> | null;
  segment?: Pick<CrmSegment, "id" | "recruiterId" | "name"> | null;
  /** If true, also run prepareCampaignSend (still requires campaign confirm semantics). */
  confirmSend?: boolean;
  existingRecipients?: Parameters<typeof prepareCampaignSend>[0]["existingRecipients"];
};

export type DraftOutreachResult =
  | {
      ok: true;
      campaign: CrmCampaign;
      preview: ReturnType<typeof buildCampaignPreview>;
      message: string;
      send?: PrepareCampaignSendResult;
    }
  | { ok: false; code: "forbidden" | "validation"; message: string };

/**
 * Draft a CRM outreach campaign for an owned job. Aligns with HireHub CRM fields.
 * Does not email anyone unless confirmSend + prepareCampaignSend succeed.
 */
export function draftRecruiterOutreach(
  input: DraftOutreachInput,
  deps: RecruiterAgentDeps,
): DraftOutreachResult {
  if (!input.job?.id || !input.job.recruiterId) {
    return { ok: false, code: "validation", message: "Owned job is required." };
  }

  if (
    !canAccessCrmOwnedResource({
      ownerRecruiterId: input.job.recruiterId,
      callerId: deps.callerId,
      callerRole: deps.callerRole,
    })
  ) {
    return {
      ok: false,
      code: "forbidden",
      message: "You can only draft outreach for jobs you own.",
    };
  }

  if (input.contact && input.contact.recruiterId !== input.job.recruiterId) {
    return {
      ok: false,
      code: "forbidden",
      message: "Contact belongs to another recruiter.",
    };
  }
  if (input.segment && input.segment.recruiterId !== input.job.recruiterId) {
    return {
      ok: false,
      code: "forbidden",
      message: "Segment belongs to another recruiter.",
    };
  }

  const ownerId = input.job.recruiterId;
  const seekerLabel = input.contact?.fullName?.trim() || "candidate";
  const campaign = createCampaignRecord({
    recruiterId: ownerId,
    segmentId: input.segment?.id ?? null,
    name: `Outreach: ${input.job.title}`.slice(0, 120),
    subject: `Opportunity: ${input.job.title}`.slice(0, 200),
    htmlBody: [
      `<p>Hi ${seekerLabel},</p>`,
      `<p>We thought you might be a strong fit for <strong>${input.job.title}</strong> on HireHub.</p>`,
      `<p>If you are interested, reply to this email or apply in HireHub.</p>`,
      `<p>Best regards</p>`,
    ].join("\n"),
  });

  if ("error" in campaign) {
    return { ok: false, code: "validation", message: campaign.error };
  }

  const preview = buildCampaignPreview(campaign);
  let send: PrepareCampaignSendResult | undefined;
  if (input.confirmSend) {
    const segment: CrmSegment | null = input.segment
      ? {
          id: input.segment.id,
          recruiterId: input.segment.recruiterId,
          name: input.segment.name,
          kind: "active",
          filter: {},
          createdAt: new Date().toISOString(),
        }
      : null;
    const contacts: CrmContact[] = input.contact
      ? [
          {
            id: input.contact.id,
            recruiterId: input.contact.recruiterId,
            email: input.contact.email,
            emailNormalized: input.contact.email.toLowerCase(),
            fullName: input.contact.fullName ?? null,
            skills: [],
            jobInterests: [],
            applicationStatus: null,
            segmentKind: "active",
            companyId: null,
            seekerProfileId: null,
            hubspotContactId: null,
            notes: null,
            createdAt: new Date().toISOString(),
          },
        ]
      : [];
    send = prepareCampaignSend({
      campaign,
      segment,
      contacts,
      existingRecipients: input.existingRecipients ?? [],
      confirm: true,
    });
  }

  return {
    ok: true,
    campaign,
    preview,
    send,
    message: input.confirmSend
      ? "Outreach draft prepared; send result attached when confirmSend was set."
      : "Outreach draft created. Review in CRM before sending.",
  };
}

/** Structured handoff error for supervisor / UI. */
export function recruiterHandoffError(
  result: ShortlistResult | DraftOutreachResult,
): { code: string; message: string } | null {
  if (result.ok) return null;
  return { code: result.code, message: result.message };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_IN_TEXT_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

export function looksLikeShortlistIntent(question: string): boolean {
  // Natural chat often says "short list from X" / typos without the word "applicant".
  return /\b(short[\s-]?list(?:ed)?|mark\s+as\s+short[\s-]?list|move\s+to\s+interview|reject\s+applicant|hire\s+applicant)\b/i.test(
    question,
  );
}

export function looksLikeOutreachDraftIntent(question: string): boolean {
  return (
    /\b(draft|write|prepare|create)\b/i.test(question) &&
    /\b(outreach|email\s+campaign|campaign|email)\b/i.test(question)
  );
}

function uuidNearApplicationContext(question: string): string | null {
  const match = question.match(
    /\bapplication\b[^0-9a-f-]{0,24}([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i,
  );
  return match?.[1] ?? null;
}

function uuidNearJobContext(question: string): string | null {
  const match = question.match(
    /\bjob\b[^0-9a-f-]{0,24}([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i,
  );
  return match?.[1] ?? null;
}

export function extractRecruiterApplicationId(input: {
  question: string;
  applicationId?: string | null;
}): string | null {
  if (input.applicationId && UUID_RE.test(input.applicationId.trim())) {
    return input.applicationId.trim();
  }
  const contextual = uuidNearApplicationContext(input.question);
  if (contextual) return contextual;
  const fromQuestion = input.question.match(UUID_IN_TEXT_RE);
  return fromQuestion?.[0] ?? null;
}

export function extractRecruiterJobId(input: {
  question: string;
  jobId?: string | null;
}): string | null {
  if (input.jobId && UUID_RE.test(input.jobId.trim())) {
    return input.jobId.trim();
  }
  const contextual = uuidNearJobContext(input.question);
  if (contextual) return contextual;
  const fromQuestion = input.question.match(UUID_IN_TEXT_RE);
  return fromQuestion?.[0] ?? null;
}
