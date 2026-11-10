/**
 * Keep in sync with src/lib/crm/webhook-recipient-tracking.ts (Edge deploy bundle).
 */

export type WebhookCrmTrackingStatus =
  | "sent"
  | "delivered"
  | "opened"
  | "bounced"
  | "complained";

const ALL_STATUSES = [
  "pending",
  "sent",
  "delivered",
  "opened",
  "bounced",
  "complained",
  "replied",
  "applied",
] as const;

export type CrmRecipientTrackingStatus = (typeof ALL_STATUSES)[number];

export function priorStatusesForWebhookUpdate(
  next: WebhookCrmTrackingStatus,
): readonly CrmRecipientTrackingStatus[] {
  switch (next) {
    case "sent":
      return ["pending"];
    case "delivered":
      return ["pending", "sent"];
    case "opened":
      return ["pending", "sent", "delivered"];
    case "bounced":
      return ["pending", "sent", "delivered"];
    case "complained":
      return ["pending", "sent", "delivered", "bounced"];
    default:
      return [];
  }
}

export function buildWebhookRecipientPatch(
  next: WebhookCrmTrackingStatus,
  nowIso = new Date().toISOString(),
): Record<string, unknown> {
  const patch: Record<string, unknown> = { tracking_status: next };
  if (next === "opened") patch.opened_at = nowIso;
  if (next === "sent" || next === "delivered") patch.sent_at = nowIso;
  return patch;
}
