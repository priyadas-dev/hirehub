/**
 * Unified email activity — pure aggregation and display helpers.
 * No database calls; consumed by email-activity.server.ts and tests.
 */

// ─── Input types (raw DB rows, normalised before passing in) ──────────────────

export type RawDeliveryEvent = {
  /** Resend email ID — shared by multiple events for the same send. Null for pre-fix events. */
  emailId: string | null;
  /** Resend event type, e.g. "email.sent", "email.delivered", "email.opened". */
  eventType: string;
  /** Mapped tracking status from mapResendEventToTracking. */
  trackingStatus: string;
  applicationId: string | null;
  createdAt: string;
};

export type ResolvedApplication = {
  applicationId: string;
  seekerEmail: string | null;
  seekerName: string | null;
  jobTitle: string | null;
};

export type RawCampaignRecipient = {
  id: string;
  email: string;
  fullName: string | null;
  /** Best tracking status already maintained by the EF (CRM_TRACKING_STATUSES). */
  trackingStatus: string;
  campaignName: string;
  campaignId: string;
  sentAt: string | null;
  createdAt: string | null;
};

// ─── Output types ─────────────────────────────────────────────────────────────

export type EmailActivityAggregate = {
  /** Unique emails that were attempted (at least one event). */
  sent: number;
  /** Unique emails with an explicit "email.delivered" event. */
  delivered: number;
  /** Unique emails where the best status is "opened". */
  opened: number;
  /** Unique emails where the best status is "bounced" or "complained". */
  bounced: number;
};

export type EmailActivityItem = {
  id: string;
  emailType: "application_status" | "campaign";
  recipientEmail: string | null;
  recipientName: string | null;
  /** Job title for application_status; campaign name for campaign. */
  relatedLabel: string | null;
  trackingStatus: string;
  createdAt: string;
  applicationId: string | null;
  campaignRecipientId: string | null;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Priority for picking the "best" status per email_id group.
 * Higher number wins. opened > bounced/complained > sent > other.
 */
const STATUS_RANK: Record<string, number> = {
  other: 0,
  sent: 1,
  bounced: 2,
  complained: 2,
  opened: 3,
};

function rankOf(status: string): number {
  return STATUS_RANK[status] ?? 0;
}

// ─── Aggregation functions ────────────────────────────────────────────────────

type EmailGroup = {
  eventTypes: Set<string>;
  bestStatus: string;
  applicationId: string | null;
  latestAt: string;
};

/**
 * Aggregate application-status delivery events.
 *
 * Groups by email_id (events with null email_id are each treated as a separate
 * unique email so pre-fix rows still count towards totals).
 *
 * Returns:
 *   - `aggregate` with cumulative per-category counts
 *   - `bestStatusByKey` map for building the recent-activity list
 */
export function aggregateDeliveryEvents(events: RawDeliveryEvent[]): {
  aggregate: EmailActivityAggregate;
  bestStatusByKey: Map<string, { status: string; appId: string | null; latestAt: string }>;
} {
  const byKey = new Map<string, EmailGroup>();

  events.forEach((e, idx) => {
    // null email_id: treat as its own unique key so it still counts as "sent".
    const key = e.emailId ?? `__noid_${idx}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        eventTypes: new Set([e.eventType]),
        bestStatus: e.trackingStatus,
        applicationId: e.applicationId,
        latestAt: e.createdAt,
      });
    } else {
      existing.eventTypes.add(e.eventType);
      if (rankOf(e.trackingStatus) > rankOf(existing.bestStatus)) {
        existing.bestStatus = e.trackingStatus;
      }
      if (e.createdAt > existing.latestAt) existing.latestAt = e.createdAt;
    }
  });

  const aggregate: EmailActivityAggregate = { sent: 0, delivered: 0, opened: 0, bounced: 0 };
  const bestStatusByKey = new Map<string, { status: string; appId: string | null; latestAt: string }>();

  for (const [key, group] of byKey) {
    aggregate.sent += 1; // every unique email = one send
    if (group.eventTypes.has("email.delivered")) aggregate.delivered += 1;
    if (group.bestStatus === "opened") aggregate.opened += 1;
    if (group.bestStatus === "bounced" || group.bestStatus === "complained") aggregate.bounced += 1;
    bestStatusByKey.set(key, {
      status: group.bestStatus,
      appId: group.applicationId,
      latestAt: group.latestAt,
    });
  }

  return { aggregate, bestStatusByKey };
}

/**
 * Aggregate campaign recipients.
 * Each recipient row already carries the best tracking status (maintained by the EF).
 * "sent" and "delivered" are distinct statuses in the CRM tracking vocabulary.
 */
export function aggregateCampaignRecipients(recipients: RawCampaignRecipient[]): EmailActivityAggregate {
  const agg: EmailActivityAggregate = { sent: 0, delivered: 0, opened: 0, bounced: 0 };
  for (const r of recipients) {
    const s = r.trackingStatus;
    // Count as "sent" if the email left the queue.
    if (s === "sent" || s === "delivered" || s === "opened") agg.sent += 1;
    if (s === "delivered") agg.delivered += 1;
    if (s === "opened") agg.opened += 1;
    if (s === "bounced" || s === "complained") agg.bounced += 1;
  }
  return agg;
}

/** Merge two aggregates by summing each field. */
export function mergeAggregates(
  a: EmailActivityAggregate,
  b: EmailActivityAggregate,
): EmailActivityAggregate {
  return {
    sent: a.sent + b.sent,
    delivered: a.delivered + b.delivered,
    opened: a.opened + b.opened,
    bounced: a.bounced + b.bounced,
  };
}

// ─── Recent-activity list builders ───────────────────────────────────────────

/**
 * Build recent activity items for application-status emails.
 *
 * - Input events must arrive sorted newest-first (the server fn orders by created_at DESC).
 * - Deduplicates by email_id — one row per unique send, with the best status.
 * - Skips events where both applicationId and emailId are null (unresolvable pre-fix row).
 */
export function buildApplicationActivityItems(
  events: RawDeliveryEvent[],
  resolvedByAppId: Map<string, ResolvedApplication>,
  limit: number,
): EmailActivityItem[] {
  const { bestStatusByKey } = aggregateDeliveryEvents(events);
  const items: EmailActivityItem[] = [];
  const seenKeys = new Set<string>();

  for (const e of events) {
    // Skip entirely unresolvable rows.
    if (!e.applicationId && !e.emailId) continue;

    const key = e.emailId ?? `__noid_${e.applicationId ?? e.createdAt}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const resolved = e.applicationId ? resolvedByAppId.get(e.applicationId) : null;
    const best = bestStatusByKey.get(key);

    items.push({
      id: `app:${e.emailId ?? e.applicationId ?? e.createdAt}`,
      emailType: "application_status",
      recipientEmail: resolved?.seekerEmail ?? null,
      recipientName: resolved?.seekerName ?? null,
      relatedLabel: resolved?.jobTitle ?? null,
      trackingStatus: best?.status ?? e.trackingStatus,
      createdAt: best?.latestAt ?? e.createdAt,
      applicationId: e.applicationId,
      campaignRecipientId: null,
    });

    if (items.length >= limit) break;
  }

  return items;
}

/**
 * Build recent activity items for campaign emails.
 * Input is already sorted newest-first by the server fn.
 */
export function buildCampaignActivityItems(
  recipients: RawCampaignRecipient[],
  limit: number,
): EmailActivityItem[] {
  return recipients.slice(0, limit).map((r) => ({
    id: `campaign:${r.id}`,
    emailType: "campaign" as const,
    recipientEmail: r.email,
    recipientName: r.fullName,
    relatedLabel: r.campaignName,
    trackingStatus: r.trackingStatus,
    createdAt: r.sentAt ?? r.createdAt ?? new Date(0).toISOString(),
    applicationId: null,
    campaignRecipientId: r.id,
  }));
}

/**
 * Merge two activity item arrays, sort by createdAt descending, cap at limit.
 */
export function mergeAndSortActivityItems(
  items: EmailActivityItem[],
  limit: number,
): EmailActivityItem[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
