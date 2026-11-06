import { resolveSegmentAudience } from "@/lib/crm/segments";
import type {
  CrmCampaign,
  CrmCampaignRecipient,
  CrmCampaignStatus,
  CrmContact,
  CrmSegment,
  CrmTrackingStatus,
} from "@/lib/crm/types";

export function campaignSendIdempotencyKey(campaignId: string): string {
  return `crm:campaign:send:${campaignId}`;
}

export function recipientSendIdempotencyKey(campaignId: string, contactId: string): string {
  return `crm:campaign:recipient:${campaignId}:${contactId}`;
}

export function createCampaignRecord(input: {
  id?: string;
  recruiterId: string;
  segmentId?: string | null;
  name: string;
  subject?: string;
  htmlBody?: string;
  status?: CrmCampaignStatus;
  createdAt?: string;
}): CrmCampaign | { error: string } {
  if (!input.recruiterId) return { error: "recruiterId is required" };
  const name = input.name.trim();
  if (!name) return { error: "Campaign name is required" };
  return {
    id: input.id ?? crypto.randomUUID(),
    recruiterId: input.recruiterId,
    segmentId: input.segmentId ?? null,
    name,
    subject: (input.subject ?? "").trim(),
    htmlBody: input.htmlBody ?? "",
    status: input.status ?? "draft",
    sendIdempotencyKey: null,
    confirmedAt: null,
    sentAt: null,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

/** Apply in-form draft values over the persisted campaign (detail page before save). */
export function mergeCampaignDraft(
  campaign: CrmCampaign,
  draft: { subject: string; htmlBody: string },
): CrmCampaign {
  return {
    ...campaign,
    subject: draft.subject,
    htmlBody: draft.htmlBody,
  };
}

export function buildCampaignPreview(campaign: CrmCampaign): {
  subject: string;
  html: string;
  ready: boolean;
  blockers: string[];
} {
  const blockers: string[] = [];
  if (!campaign.subject.trim()) blockers.push("Subject is required");
  if (!campaign.htmlBody.trim()) blockers.push("Email body is required");
  if (!campaign.segmentId) blockers.push("Audience segment is required");
  return {
    subject: campaign.subject,
    html: campaign.htmlBody,
    ready: blockers.length === 0,
    blockers,
  };
}

export type PrepareCampaignSendResult =
  | {
      ok: true;
      campaign: CrmCampaign;
      recipients: CrmCampaignRecipient[];
      alreadySent: boolean;
    }
  | { ok: false; error: string };

/**
 * Build recipient rows for send. Requires explicit confirm=true.
 * Idempotent: if campaign already has sendIdempotencyKey and status sent, returns alreadySent.
 */
export function prepareCampaignSend(input: {
  campaign: CrmCampaign;
  segment: CrmSegment | null;
  contacts: CrmContact[];
  existingRecipients: CrmCampaignRecipient[];
  confirm: boolean;
  nowIso?: string;
  manualMemberContactIds?: string[];
}): PrepareCampaignSendResult {
  if (!input.confirm) {
    return { ok: false, error: "Explicit confirmation is required before sending" };
  }

  if (input.campaign.recruiterId !== input.segment?.recruiterId && input.segment) {
    return { ok: false, error: "Segment does not belong to this campaign owner" };
  }

  if (
    input.campaign.status === "sent" &&
    input.campaign.sendIdempotencyKey === campaignSendIdempotencyKey(input.campaign.id)
  ) {
    return {
      ok: true,
      campaign: input.campaign,
      recipients: input.existingRecipients.filter((r) => r.campaignId === input.campaign.id),
      alreadySent: true,
    };
  }

  const preview = buildCampaignPreview(input.campaign);
  if (!preview.ready) {
    return { ok: false, error: preview.blockers.join("; ") };
  }
  if (!input.segment) {
    return { ok: false, error: "Audience segment is required" };
  }
  if (input.segment.id !== input.campaign.segmentId) {
    return { ok: false, error: "Campaign segment mismatch" };
  }

  const audience = resolveSegmentAudience(input.contacts, input.segment, {
    manualMemberContactIds: input.manualMemberContactIds,
  });
  if (audience.length === 0) {
    return { ok: false, error: "Segment has no matching contacts" };
  }

  const now = input.nowIso ?? new Date().toISOString();
  const sendKey = campaignSendIdempotencyKey(input.campaign.id);
  const byContact = new Map(
    input.existingRecipients
      .filter((r) => r.campaignId === input.campaign.id)
      .map((r) => [r.contactId, r]),
  );

  const recipients: CrmCampaignRecipient[] = audience.map((contact) => {
    const existing = byContact.get(contact.id);
    if (existing) return existing;
    return {
      id: crypto.randomUUID(),
      campaignId: input.campaign.id,
      contactId: contact.id,
      recruiterId: input.campaign.recruiterId,
      email: contact.email,
      trackingStatus: "pending",
      resendEmailId: null,
      sendIdempotencyKey: recipientSendIdempotencyKey(input.campaign.id, contact.id),
      hubspotSyncOk: null,
      hubspotSyncReason: null,
      sentAt: null,
      openedAt: null,
    };
  });

  const campaign: CrmCampaign = {
    ...input.campaign,
    status: "sending",
    sendIdempotencyKey: sendKey,
    confirmedAt: input.campaign.confirmedAt ?? now,
  };

  return { ok: true, campaign, recipients, alreadySent: false };
}

export function markRecipientSent(
  recipient: CrmCampaignRecipient,
  resendEmailId: string,
  nowIso = new Date().toISOString(),
): CrmCampaignRecipient {
  if (recipient.trackingStatus === "sent" || recipient.trackingStatus === "opened" || recipient.trackingStatus === "delivered") {
    return recipient;
  }
  return {
    ...recipient,
    trackingStatus: "sent",
    resendEmailId,
    sentAt: nowIso,
  };
}

export function markCampaignSent(
  campaign: CrmCampaign,
  nowIso = new Date().toISOString(),
): CrmCampaign {
  return {
    ...campaign,
    status: "sent",
    sentAt: nowIso,
    sendIdempotencyKey: campaign.sendIdempotencyKey ?? campaignSendIdempotencyKey(campaign.id),
  };
}

const TRACKING_RANK: Record<CrmTrackingStatus, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  replied: 4,
  applied: 5,
  bounced: 2,
  complained: 2,
};

export function applyRecipientTrackingEvent(
  recipient: CrmCampaignRecipient,
  event: "sent" | "delivered" | "opened" | "bounced" | "complained",
  nowIso = new Date().toISOString(),
): CrmCampaignRecipient {
  const nextStatus: CrmTrackingStatus =
    event === "delivered" ? "delivered" : event === "sent" ? "sent" : event;

  const currentRank = TRACKING_RANK[recipient.trackingStatus] ?? 0;
  const nextRank = TRACKING_RANK[nextStatus] ?? 0;

  // Do not downgrade opened → sent on replay of earlier events.
  if (recipient.trackingStatus === "opened" && (nextStatus === "sent" || nextStatus === "delivered")) {
    return recipient;
  }
  if (nextRank < currentRank && nextStatus !== "bounced" && nextStatus !== "complained") {
    return recipient;
  }

  return {
    ...recipient,
    trackingStatus: nextStatus,
    openedAt: nextStatus === "opened" ? recipient.openedAt ?? nowIso : recipient.openedAt,
    sentAt: nextStatus === "sent" || nextStatus === "delivered" ? recipient.sentAt ?? nowIso : recipient.sentAt,
  };
}

export function summarizeCampaignTracking(recipients: CrmCampaignRecipient[]): {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  opened: number;
  bounced: number;
  complained: number;
  replied: number;
  applied: number;
} {
  const summary = {
    total: recipients.length,
    pending: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    bounced: 0,
    complained: 0,
    replied: 0,
    applied: 0,
  };
  for (const r of recipients) {
    if (r.trackingStatus === "pending") summary.pending += 1;
    else if (r.trackingStatus === "sent") summary.sent += 1;
    else if (r.trackingStatus === "delivered") summary.delivered += 1;
    else if (r.trackingStatus === "opened") summary.opened += 1;
    else if (r.trackingStatus === "bounced") summary.bounced += 1;
    else if (r.trackingStatus === "complained") summary.complained += 1;
    else if (r.trackingStatus === "replied") summary.replied += 1;
    else if (r.trackingStatus === "applied") summary.applied += 1;
  }
  return summary;
}
