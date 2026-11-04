/** CRM recipient / UI tracking derived from Resend webhook `type`. */
export type ResendCrmTrackingStatus =
  | "sent"
  | "delivered"
  | "opened"
  | "bounced"
  | "complained"
  | "other";

/**
 * Values allowed on `email_delivery_events.tracking_status` (PROPOSED_0020).
 * `email.delivered` is stored as `sent` here; use `event_type` for the precise event.
 */
export type EmailDeliveryRowTrackingStatus =
  | "sent"
  | "opened"
  | "bounced"
  | "complained"
  | "other";

export function mapResendEventToCrmTracking(eventType: string): ResendCrmTrackingStatus {
  switch (eventType) {
    case "email.sent":
      return "sent";
    case "email.delivered":
      return "delivered";
    case "email.opened":
      return "opened";
    case "email.bounced":
      return "bounced";
    case "email.complained":
      return "complained";
    default:
      return "other";
  }
}

export function mapResendEventToEmailDeliveryRow(
  eventType: string,
): EmailDeliveryRowTrackingStatus {
  const crm = mapResendEventToCrmTracking(eventType);
  if (crm === "delivered") return "sent";
  if (crm === "sent" || crm === "opened" || crm === "bounced" || crm === "complained") return crm;
  return "other";
}

/** @deprecated Use mapResendEventToCrmTracking — kept for existing imports. */
export function mapResendEventToTracking(eventType: string): ResendCrmTrackingStatus {
  return mapResendEventToCrmTracking(eventType);
}
