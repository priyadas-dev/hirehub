import {
  filterContactsForRecruiter,
  upsertContactAvoidingDuplicate,
  type CreateContactInput,
} from "@/lib/crm/contacts";
import { createSegmentRecord } from "@/lib/crm/segments";
import {
  applyRecipientTrackingEvent,
  createCampaignRecord,
  markCampaignSent,
  markRecipientSent,
  prepareCampaignSend,
  summarizeCampaignTracking,
} from "@/lib/crm/campaigns";
import type {
  CrmCampaign,
  CrmCampaignRecipient,
  CrmContact,
  CrmSegment,
  CrmSegmentFilter,
  CrmTrackingStatus,
} from "@/lib/crm/types";
import { canAccessCrmOwnedResource } from "@/lib/crm/ownership";
import {
  assertCampaignSegmentSameOwner,
  assertRecipientOwnershipCohesion,
  assertRecipientRetargetAllowed,
} from "@/lib/crm/ownership-integrity";

/** In-memory CRM for unit tests — mirrors ownership + idempotency rules. */
export function createMemoryCrmStore() {
  const contacts: CrmContact[] = [];
  const segments: CrmSegment[] = [];
  const campaigns: CrmCampaign[] = [];
  const recipients: CrmCampaignRecipient[] = [];
  const webhookEventIds = new Set<string>();

  return {
    contacts: () => [...contacts],
    segments: () => [...segments],
    campaigns: () => [...campaigns],
    recipients: () => [...recipients],

    addContact(input: CreateContactInput) {
      const result = upsertContactAvoidingDuplicate(contacts, input);
      if (result.ok && result.created) contacts.push(result.contact);
      return result;
    },

    listContacts(recruiterId: string, caller: { id: string; role: string }, filter?: CrmSegmentFilter) {
      if (!canAccessCrmOwnedResource({ ownerRecruiterId: recruiterId, callerId: caller.id, callerRole: caller.role })) {
        return { ok: false as const, error: "forbidden" };
      }
      return { ok: true as const, contacts: filterContactsForRecruiter(contacts, recruiterId, filter ?? {}) };
    },

    addSegment(input: Parameters<typeof createSegmentRecord>[0]) {
      const seg = createSegmentRecord(input);
      if ("error" in seg) return { ok: false as const, error: seg.error };
      segments.push(seg);
      return { ok: true as const, segment: seg };
    },

    getSegment(id: string) {
      return segments.find((s) => s.id === id) ?? null;
    },

    addCampaign(input: Parameters<typeof createCampaignRecord>[0]) {
      const c = createCampaignRecord(input);
      if ("error" in c) return { ok: false as const, error: c.error };
      const segment =
        c.segmentId != null ? segments.find((s) => s.id === c.segmentId) ?? null : null;
      const cohesion = assertCampaignSegmentSameOwner({
        campaignRecruiterId: c.recruiterId,
        segmentId: c.segmentId,
        segment,
      });
      if (!cohesion.ok) {
        return { ok: false as const, error: cohesion.reason, code: cohesion.code, constraint: cohesion.constraint };
      }
      campaigns.push(c);
      return { ok: true as const, campaign: c };
    },

    getCampaign(id: string) {
      return campaigns.find((c) => c.id === id) ?? null;
    },

    /** Mirrors UPDATE that changes segment_id (composite FK enforced). */
    updateCampaignSegment(input: { campaignId: string; segmentId: string | null }) {
      const campaign = campaigns.find((c) => c.id === input.campaignId);
      if (!campaign) return { ok: false as const, error: "Campaign not found" };
      const segment =
        input.segmentId != null ? segments.find((s) => s.id === input.segmentId) ?? null : null;
      const cohesion = assertCampaignSegmentSameOwner({
        campaignRecruiterId: campaign.recruiterId,
        segmentId: input.segmentId,
        segment,
      });
      if (!cohesion.ok) {
        return { ok: false as const, error: cohesion.reason, code: cohesion.code, constraint: cohesion.constraint };
      }
      const updated: CrmCampaign = { ...campaign, segmentId: input.segmentId };
      const i = campaigns.findIndex((c) => c.id === campaign.id);
      if (i >= 0) campaigns[i] = updated;
      return { ok: true as const, campaign: updated };
    },

    updateCampaign(campaign: CrmCampaign) {
      const segment =
        campaign.segmentId != null ? segments.find((s) => s.id === campaign.segmentId) ?? null : null;
      const cohesion = assertCampaignSegmentSameOwner({
        campaignRecruiterId: campaign.recruiterId,
        segmentId: campaign.segmentId,
        segment,
      });
      if (!cohesion.ok) {
        return { ok: false as const, error: cohesion.reason, code: cohesion.code, constraint: cohesion.constraint };
      }
      const i = campaigns.findIndex((c) => c.id === campaign.id);
      if (i >= 0) campaigns[i] = campaign;
      return { ok: true as const, campaign };
    },

    /**
     * Direct recipient insert (mirrors PostgREST/SQL INSERT past app AuthZ).
     * Enforces PROPOSED_0022 composite FK cohesion + UNIQUE(campaign_id, contact_id).
     */
    insertRecipient(input: {
      recruiterId: string;
      campaignId: string;
      contactId: string;
      email?: string;
    }) {
      const campaign = campaigns.find((c) => c.id === input.campaignId) ?? null;
      const contact = contacts.find((c) => c.id === input.contactId) ?? null;
      const cohesion = assertRecipientOwnershipCohesion({
        rowRecruiterId: input.recruiterId,
        campaignId: input.campaignId,
        contactId: input.contactId,
        campaign,
        contact,
      });
      if (!cohesion.ok) {
        return { ok: false as const, error: cohesion.reason, code: cohesion.code, constraint: cohesion.constraint };
      }
      if (recipients.some((r) => r.campaignId === input.campaignId && r.contactId === input.contactId)) {
        return { ok: false as const, error: "duplicate_campaign_contact", code: "23505" as const };
      }
      const row: CrmCampaignRecipient = {
        id: crypto.randomUUID(),
        campaignId: input.campaignId,
        contactId: input.contactId,
        recruiterId: input.recruiterId,
        email: input.email ?? contact!.email,
        trackingStatus: "pending",
        resendEmailId: null,
        sendIdempotencyKey: null,
        hubspotSyncOk: null,
        hubspotSyncReason: null,
        sentAt: null,
        openedAt: null,
      };
      recipients.push(row);
      return { ok: true as const, recipient: row };
    },

    /** Service-role style tracking update (ids unchanged → always OK). */
    patchRecipientTracking(input: {
      recipientId: string;
      trackingStatus: CrmTrackingStatus;
      resendEmailId?: string | null;
    }) {
      const idx = recipients.findIndex((r) => r.id === input.recipientId);
      if (idx < 0) return { ok: false as const, error: "recipient_not_found" };
      const current = recipients[idx]!;
      recipients[idx] = {
        ...current,
        trackingStatus: input.trackingStatus,
        resendEmailId: input.resendEmailId === undefined ? current.resendEmailId : input.resendEmailId,
      };
      return { ok: true as const, recipient: recipients[idx]! };
    },

    /** Service-role attempt to retarget campaign/contact ids (FK-checked). */
    retargetRecipient(input: {
      recipientId: string;
      campaignId: string;
      contactId: string;
      recruiterId?: string;
    }) {
      const idx = recipients.findIndex((r) => r.id === input.recipientId);
      if (idx < 0) return { ok: false as const, error: "recipient_not_found" };
      const current = recipients[idx]!;
      const rowRecruiterId = input.recruiterId ?? current.recruiterId;
      const campaign = campaigns.find((c) => c.id === input.campaignId) ?? null;
      const contact = contacts.find((c) => c.id === input.contactId) ?? null;
      const cohesion = assertRecipientRetargetAllowed({
        rowRecruiterId,
        nextCampaignId: input.campaignId,
        nextContactId: input.contactId,
        nextCampaign: campaign,
        nextContact: contact,
      });
      if (!cohesion.ok) {
        return { ok: false as const, error: cohesion.reason, code: cohesion.code, constraint: cohesion.constraint };
      }
      recipients[idx] = {
        ...current,
        campaignId: input.campaignId,
        contactId: input.contactId,
        recruiterId: rowRecruiterId,
      };
      return { ok: true as const, recipient: recipients[idx]! };
    },

    sendCampaign(input: {
      campaignId: string;
      callerId: string;
      callerRole: string;
      confirm: boolean;
      sendEmail?: (r: CrmCampaignRecipient) => Promise<{ messageId: string } | { skipped: string } | { error: string }>;
    }) {
      const campaign = campaigns.find((c) => c.id === input.campaignId);
      if (!campaign) return Promise.resolve({ ok: false as const, error: "Campaign not found" });
      if (
        !canAccessCrmOwnedResource({
          ownerRecruiterId: campaign.recruiterId,
          callerId: input.callerId,
          callerRole: input.callerRole,
        })
      ) {
        return Promise.resolve({ ok: false as const, error: "Cannot access another recruiter's CRM records" });
      }
      const segment = campaign.segmentId ? segments.find((s) => s.id === campaign.segmentId) ?? null : null;
      const prepared = prepareCampaignSend({
        campaign,
        segment,
        contacts,
        existingRecipients: recipients,
        confirm: input.confirm,
      });
      if (!prepared.ok) return Promise.resolve(prepared);
      if (prepared.alreadySent) {
        return Promise.resolve({
          ok: true as const,
          alreadySent: true,
          campaign: prepared.campaign,
          summary: summarizeCampaignTracking(prepared.recipients),
        });
      }

      return (async () => {
        for (const recipient of prepared.recipients) {
          const existingIdx = recipients.findIndex((r) => r.id === recipient.id);
          if (existingIdx < 0) recipients.push(recipient);
          if (recipient.trackingStatus === "sent" || recipient.trackingStatus === "opened") continue;

          if (input.sendEmail) {
            const sent = await input.sendEmail(recipient);
            if ("messageId" in sent) {
              const updated = markRecipientSent(recipient, sent.messageId);
              const idx = recipients.findIndex((r) => r.id === recipient.id);
              if (idx >= 0) recipients[idx] = updated;
            }
          } else {
            const updated = markRecipientSent(recipient, `mem_${recipient.id}`);
            const idx = recipients.findIndex((r) => r.id === recipient.id);
            if (idx >= 0) recipients[idx] = updated;
          }
        }

        const finalCampaign = markCampaignSent(prepared.campaign);
        const ci = campaigns.findIndex((c) => c.id === finalCampaign.id);
        if (ci >= 0) campaigns[ci] = finalCampaign;

        return {
          ok: true as const,
          alreadySent: false,
          campaign: finalCampaign,
          summary: summarizeCampaignTracking(recipients.filter((r) => r.campaignId === finalCampaign.id)),
        };
      })();
    },

    /** Idempotent webhook apply by event id. */
    applyWebhook(input: {
      eventId: string;
      recipientId: string;
      event: "sent" | "delivered" | "opened" | "bounced" | "complained";
    }) {
      if (webhookEventIds.has(input.eventId)) {
        return { ok: true as const, duplicate: true, recipient: recipients.find((r) => r.id === input.recipientId) ?? null };
      }
      webhookEventIds.add(input.eventId);
      const idx = recipients.findIndex((r) => r.id === input.recipientId);
      if (idx < 0) return { ok: false as const, error: "recipient_not_found" };
      recipients[idx] = applyRecipientTrackingEvent(recipients[idx]!, input.event);
      return { ok: true as const, duplicate: false, recipient: recipients[idx]! };
    },

    dashboard(recruiterId: string) {
      const myContacts = contacts.filter((c) => c.recruiterId === recruiterId);
      const myCampaigns = campaigns.filter((c) => c.recruiterId === recruiterId);
      const myRecipients = recipients.filter((r) => r.recruiterId === recruiterId);
      return {
        contactCount: myContacts.length,
        segmentCount: segments.filter((s) => s.recruiterId === recruiterId).length,
        campaignCount: myCampaigns.length,
        tracking: summarizeCampaignTracking(myRecipients),
      };
    },
  };
}

export type MemoryCrmStore = ReturnType<typeof createMemoryCrmStore>;
