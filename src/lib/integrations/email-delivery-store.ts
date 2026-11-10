/**
 * Idempotent store for Resend/Svix webhook events.
 * Memory store for tests; Supabase adapter used when table exists (PROPOSED_0020).
 */

import type { ResendCrmTrackingStatus } from "@/lib/integrations/resend-event-mapping";

export type EmailDeliveryEvent = {
  provider: "resend";
  eventId: string;
  emailId: string | null;
  eventType: string;
  trackingStatus: ResendCrmTrackingStatus;
  applicationId: string | null;
  campaignRecipientId: string | null;
  payloadMeta: Record<string, unknown>;
};

export type EmailDeliveryStore = {
  /** @returns true if this eventId was newly recorded; false if replay. */
  recordIfNew: (event: EmailDeliveryEvent) => Promise<boolean>;
  count: () => Promise<number>;
  getTracking: (applicationId: string) => Promise<"sent" | "opened" | null>;
  getCampaignRecipientTracking: (
    campaignRecipientId: string,
  ) => Promise<"sent" | "delivered" | "opened" | "bounced" | "complained" | null>;
};

export function createMemoryEmailDeliveryStore(): EmailDeliveryStore {
  const byEventId = new Map<string, EmailDeliveryEvent>();
  const trackingByApp = new Map<string, "sent" | "opened">();
  const trackingByRecipient = new Map<
    string,
    "sent" | "delivered" | "opened" | "bounced" | "complained"
  >();

  return {
    async recordIfNew(event) {
      if (byEventId.has(event.eventId)) return false;
      byEventId.set(event.eventId, event);
      if (
        event.applicationId &&
        (event.trackingStatus === "sent" ||
          event.trackingStatus === "delivered" ||
          event.trackingStatus === "opened")
      ) {
        const prev = trackingByApp.get(event.applicationId);
        const asApp: "sent" | "opened" =
          event.trackingStatus === "opened" ? "opened" : "sent";
        if (asApp === "opened" || !prev) {
          trackingByApp.set(event.applicationId, asApp);
        } else if (asApp === "sent" && prev !== "opened") {
          trackingByApp.set(event.applicationId, "sent");
        }
      }
      if (event.campaignRecipientId && event.trackingStatus !== "other") {
        const prev = trackingByRecipient.get(event.campaignRecipientId);
        const next = event.trackingStatus;
        const rank: Record<string, number> = {
          sent: 1,
          delivered: 2,
          bounced: 2,
          complained: 2,
          opened: 3,
        };
        const prevRank = prev ? (rank[prev] ?? 0) : 0;
        const nextRank = rank[next] ?? 0;
        if (next === "bounced" || next === "complained") {
          trackingByRecipient.set(event.campaignRecipientId, next);
        } else if (next === "opened" || !prev || nextRank >= prevRank) {
          trackingByRecipient.set(event.campaignRecipientId, next);
        }
      }
      return true;
    },
    async count() {
      return byEventId.size;
    },
    async getTracking(applicationId) {
      return trackingByApp.get(applicationId) ?? null;
    },
    async getCampaignRecipientTracking(campaignRecipientId) {
      return trackingByRecipient.get(campaignRecipientId) ?? null;
    },
  };
}

export { mapResendEventToTracking } from "@/lib/integrations/resend-event-mapping";
export { mapResendEventToCrmTracking } from "@/lib/integrations/resend-event-mapping";
