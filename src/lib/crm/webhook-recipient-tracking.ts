/**
 * Monotonic CRM recipient updates for Resend webhook handlers.
 * Use `priorStatusesForWebhookUpdate` with a conditional DB UPDATE (.in tracking_status)
 * so concurrent webhooks cannot downgrade status (e.g. late email.sent after email.delivered).
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

/** Current DB statuses that may transition to `next` via webhook (atomic .in filter). */
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

/** In-memory / test helper mirroring a single atomic UPDATE row match. */
export function mergeWebhookTrackingStatus(
  current: string,
  next: WebhookCrmTrackingStatus,
): WebhookCrmTrackingStatus | null {
  const allowed = priorStatusesForWebhookUpdate(next);
  if (!allowed.includes(current as CrmRecipientTrackingStatus)) return null;
  return next;
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
