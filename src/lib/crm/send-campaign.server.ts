import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendCampaignEmailViaResend } from "@/lib/crm/campaign-mail";
import {
  campaignSendIdempotencyKey,
  markCampaignSent,
  markRecipientSent,
  prepareCampaignSend,
  recipientSendIdempotencyKey,
  summarizeCampaignTracking,
} from "@/lib/crm/campaigns";
import { syncCrmContactToHubSpot } from "@/lib/crm/hubspot-contact-sync";
import { canAccessCrmOwnedResource } from "@/lib/crm/ownership";
import { parseSegmentFilter, parseSegmentType } from "@/lib/crm/segments";
import type {
  CrmCampaign,
  CrmCampaignRecipient,
  CrmCampaignStatus,
  CrmContact,
  CrmSegment,
  CrmSegmentKind,
  CrmTrackingStatus,
} from "@/lib/crm/types";

const requestSchema = z.object({
  campaignId: z.string().uuid(),
  confirm: z.literal(true),
  /** Persisted immediately before send so validation matches the editor (ownership-checked). */
  subject: z.string().optional(),
  htmlBody: z.string().optional(),
});

type LooseClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
        then?: unknown;
      } & Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
    };
    upsert: (
      row: Record<string, unknown>,
      opts?: { onConflict?: string },
    ) => Promise<{ error: { message: string; code?: string } | null }>;
    update: (row: Record<string, unknown>) => {
      eq: (col: string, val: string) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

function mapContact(row: Record<string, unknown>): CrmContact {
  return {
    id: String(row.id),
    recruiterId: String(row.recruiter_id),
    companyId: (row.company_id as string | null) ?? null,
    seekerProfileId: (row.seeker_profile_id as string | null) ?? null,
    email: String(row.email),
    emailNormalized: String(row.email_normalized),
    fullName: (row.full_name as string | null) ?? null,
    skills: Array.isArray(row.skills) ? (row.skills as string[]) : [],
    jobInterests: Array.isArray(row.job_interests) ? (row.job_interests as string[]) : [],
    jobCategories: Array.isArray(row.job_categories) ? (row.job_categories as string[]) : [],
    applicationStatus: (row.application_status as string | null) ?? null,
    segmentKind: (row.segment_kind as CrmSegmentKind) ?? "new",
    hubspotContactId: (row.hubspot_contact_id as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

function mapSegment(row: Record<string, unknown>): CrmSegment {
  return {
    id: String(row.id),
    recruiterId: String(row.recruiter_id),
    name: String(row.name),
    kind: (row.kind as CrmSegmentKind) ?? "new",
    segmentType: parseSegmentType(row.segment_type),
    filter: parseSegmentFilter(row.filter_json),
    createdAt: String(row.created_at),
  };
}

function mapCampaign(row: Record<string, unknown>): CrmCampaign {
  return {
    id: String(row.id),
    recruiterId: String(row.recruiter_id),
    segmentId: (row.segment_id as string | null) ?? null,
    name: String(row.name),
    subject: String(row.subject ?? ""),
    htmlBody: String(row.html_body ?? ""),
    status: (row.status as CrmCampaignStatus) ?? "draft",
    sendIdempotencyKey: (row.send_idempotency_key as string | null) ?? null,
    confirmedAt: (row.confirmed_at as string | null) ?? null,
    sentAt: (row.sent_at as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

function mapRecipient(row: Record<string, unknown>): CrmCampaignRecipient {
  return {
    id: String(row.id),
    campaignId: String(row.campaign_id),
    contactId: String(row.contact_id),
    recruiterId: String(row.recruiter_id),
    email: String(row.email),
    trackingStatus: (row.tracking_status as CrmTrackingStatus) ?? "pending",
    resendEmailId: (row.resend_email_id as string | null) ?? null,
    sendIdempotencyKey: (row.send_idempotency_key as string | null) ?? null,
    hubspotSyncOk: (row.hubspot_sync_ok as boolean | null) ?? null,
    hubspotSyncReason: (row.hubspot_sync_reason as string | null) ?? null,
    sentAt: (row.sent_at as string | null) ?? null,
    openedAt: (row.opened_at as string | null) ?? null,
  };
}

export type SendCrmCampaignResult = {
  ok: boolean;
  alreadySent?: boolean;
  error?: string;
  summary?: ReturnType<typeof summarizeCampaignTracking>;
  emailsSkipped?: number;
  emailsFailed?: number;
};

/**
 * Confirmed campaign send via Resend. AuthZ from JWT + campaign.recruiter_id.
 * Soft-fails HubSpot; never exposes service-role to the browser.
 */
export const sendCrmCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => requestSchema.parse(data))
  .handler(async ({ data, context }): Promise<SendCrmCampaignResult> => {
    try {
      const { data: profile } = await context.supabase
        .from("profiles")
        .select("id,role")
        .eq("id", context.userId)
        .maybeSingle();
      if (!profile) return { ok: false, error: "Caller profile not found" };

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as unknown as LooseClient;

      const campaignRes = await admin.from("crm_campaigns").select("*").eq("id", data.campaignId).maybeSingle();
      if (campaignRes.error || !campaignRes.data) {
        return { ok: false, error: "Campaign not found" };
      }

      let campaign = mapCampaign(campaignRes.data);
      if (
        !canAccessCrmOwnedResource({
          ownerRecruiterId: campaign.recruiterId,
          callerId: context.userId,
          callerRole: profile.role,
        })
      ) {
        return { ok: false, error: "Cannot access another recruiter's CRM records" };
      }

      if (data.subject !== undefined || data.htmlBody !== undefined) {
        const nextSubject = data.subject !== undefined ? data.subject.trim() : campaign.subject;
        const nextHtml = data.htmlBody !== undefined ? data.htmlBody : campaign.htmlBody;
        const { error: contentError } = await admin
          .from("crm_campaigns")
          .update({
            subject: nextSubject,
            html_body: nextHtml,
            updated_at: new Date().toISOString(),
          })
          .eq("id", campaign.id)
          .eq("recruiter_id", campaign.recruiterId);
        if (contentError) {
          return { ok: false, error: contentError.message || "Could not save campaign content before send" };
        }
        campaign = { ...campaign, subject: nextSubject, htmlBody: nextHtml };
      }

      let segment: CrmSegment | null = null;
      let manualMemberContactIds: string[] | undefined;
      if (campaign.segmentId) {
        const segRes = await admin.from("crm_segments").select("*").eq("id", campaign.segmentId).maybeSingle();
        if (segRes.data) segment = mapSegment(segRes.data);
        if (segment?.segmentType === "manual") {
          const membersRes = await admin
            .from("crm_segment_members")
            .select("contact_id")
            .eq("segment_id", segment.id);
          manualMemberContactIds = ((membersRes.data ?? []) as { contact_id?: string }[])
            .map((r) => r.contact_id)
            .filter((id): id is string => typeof id === "string");
        }
      }

      const contactsRes = await admin.from("crm_contacts").select("*").eq("recruiter_id", campaign.recruiterId);
      const contacts = (contactsRes.data ?? []).map(mapContact);

      const recipientsRes = await admin
        .from("crm_campaign_recipients")
        .select("*")
        .eq("campaign_id", campaign.id);
      const existingRecipients = (recipientsRes.data ?? []).map(mapRecipient);

      const prepared = prepareCampaignSend({
        campaign,
        segment,
        contacts,
        existingRecipients,
        confirm: data.confirm,
        manualMemberContactIds,
      });
      if (!prepared.ok) return { ok: false, error: prepared.error };
      if (prepared.alreadySent) {
        return {
          ok: true,
          alreadySent: true,
          summary: summarizeCampaignTracking(prepared.recipients),
        };
      }

      await admin
        .from("crm_campaigns")
        .update({
          status: "sending",
          send_idempotency_key: campaignSendIdempotencyKey(campaign.id),
          confirmed_at: prepared.campaign.confirmedAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaign.id);

      let emailsSkipped = 0;
      let emailsFailed = 0;
      const contactById = new Map(contacts.map((c) => [c.id, c]));

      for (const recipient of prepared.recipients) {
        await admin.from("crm_campaign_recipients").upsert(
          {
            id: recipient.id,
            campaign_id: recipient.campaignId,
            contact_id: recipient.contactId,
            recruiter_id: recipient.recruiterId,
            email: recipient.email,
            tracking_status: recipient.trackingStatus,
            send_idempotency_key:
              recipient.sendIdempotencyKey ??
              recipientSendIdempotencyKey(recipient.campaignId, recipient.contactId),
          },
          { onConflict: "campaign_id,contact_id" },
        );

        if (
          recipient.trackingStatus === "sent" ||
          recipient.trackingStatus === "opened" ||
          recipient.trackingStatus === "delivered"
        ) {
          continue;
        }

        const mail = await sendCampaignEmailViaResend({
          to: recipient.email,
          subject: campaign.subject,
          html: campaign.htmlBody,
          campaignId: campaign.id,
          recipientId: recipient.id,
          contactId: recipient.contactId,
        });

        if (mail.ok && mail.skipped) {
          emailsSkipped += 1;
          continue;
        }
        if (!mail.ok) {
          emailsFailed += 1;
          continue;
        }

        const updated = markRecipientSent(recipient, mail.messageId);
        await admin
          .from("crm_campaign_recipients")
          .update({
            tracking_status: updated.trackingStatus,
            resend_email_id: updated.resendEmailId,
            sent_at: updated.sentAt,
          })
          .eq("id", recipient.id);

        const contact = contactById.get(recipient.contactId);
        const hs = await syncCrmContactToHubSpot({
          email: recipient.email,
          fullName: contact?.fullName ?? null,
          contactId: recipient.contactId,
          segmentKind: contact?.segmentKind,
        });

        const syncOk = hs.ok && !hs.skipped ? true : hs.ok ? null : false;
        const syncReason = hs.ok ? (hs.skipped ? hs.reason : null) : hs.reason;
        await admin
          .from("crm_campaign_recipients")
          .update({
            hubspot_sync_ok: syncOk,
            hubspot_sync_reason: syncReason,
          })
          .eq("id", recipient.id);

        if (hs.ok && !hs.skipped && hs.hubspotContactId) {
          await admin
            .from("crm_contacts")
            .update({ hubspot_contact_id: hs.hubspotContactId })
            .eq("id", recipient.contactId);
        }
      }

      const finalCampaign = markCampaignSent(prepared.campaign);
      await admin
        .from("crm_campaigns")
        .update({
          status: "sent",
          sent_at: finalCampaign.sentAt,
          send_idempotency_key: finalCampaign.sendIdempotencyKey,
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaign.id);

      const refreshed = await admin
        .from("crm_campaign_recipients")
        .select("*")
        .eq("campaign_id", campaign.id);
      const finalRecipients = (refreshed.data ?? []).map(mapRecipient);

      return {
        ok: true,
        alreadySent: false,
        summary: summarizeCampaignTracking(finalRecipients),
        emailsSkipped,
        emailsFailed,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Campaign send failed",
      };
    }
  });
