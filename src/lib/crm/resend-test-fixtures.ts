import type { CrmCampaignRecipient, CrmCampaignStatus } from "@/lib/crm/types";

/** Official Resend sandbox recipients (no real inbox delivery). */
export const RESEND_TEST_RECIPIENTS = [
  {
    email: "delivered@resend.dev",
    fullName: "Resend test — delivered",
    notes: "Simulates successful delivery via Resend webhooks.",
  },
  {
    email: "bounced@resend.dev",
    fullName: "Resend test — bounced",
    notes: "Simulates a hard bounce via Resend webhooks.",
  },
  {
    email: "complained@resend.dev",
    fullName: "Resend test — complained",
    notes: "Simulates a spam complaint via Resend webhooks.",
  },
] as const;

export const RESEND_TEST_SEGMENT_NAME = "Resend sandbox test recipients";

export function isResendTestEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return RESEND_TEST_RECIPIENTS.some((r) => r.email === normalized);
}

/**
 * UI-only label when campaign send finished but Resend never accepted a recipient.
 * Does not mutate stored tracking_status.
 */
export function displayCampaignRecipientTracking(
  recipient: Pick<CrmCampaignRecipient, "trackingStatus" | "resendEmailId">,
  campaignStatus: CrmCampaignStatus,
): string {
  if (
    campaignStatus === "sent" &&
    recipient.trackingStatus === "pending" &&
    !recipient.resendEmailId
  ) {
    return "failed";
  }
  return recipient.trackingStatus;
}
