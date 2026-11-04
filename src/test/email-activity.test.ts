import { describe, expect, it } from "vitest";
import {
  aggregateCampaignRecipients,
  aggregateDeliveryEvents,
  buildApplicationActivityItems,
  buildCampaignActivityItems,
  mergeAggregates,
  mergeAndSortActivityItems,
  type RawCampaignRecipient,
  type RawDeliveryEvent,
  type ResolvedApplication,
} from "@/lib/integrations/email-activity";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<RawDeliveryEvent> = {}): RawDeliveryEvent {
  return {
    emailId: "email-aaa",
    eventType: "email.sent",
    trackingStatus: "sent",
    applicationId: "app-1",
    createdAt: "2026-11-01T10:00:00.000Z",
    ...overrides,
  };
}

function makeRecipient(overrides: Partial<RawCampaignRecipient> = {}): RawCampaignRecipient {
  return {
    id: "rcp-1",
    email: "seeker@example.com",
    fullName: "Jane Seeker",
    trackingStatus: "sent",
    campaignName: "November Outreach",
    campaignId: "camp-1",
    sentAt: "2026-11-01T12:00:00.000Z",
    createdAt: "2026-11-01T12:00:00.000Z",
    ...overrides,
  };
}

function makeResolved(overrides: Partial<ResolvedApplication> = {}): ResolvedApplication {
  return {
    applicationId: "app-1",
    seekerEmail: "seeker@example.com",
    seekerName: "Jane Seeker",
    jobTitle: "Frontend Engineer",
    ...overrides,
  };
}

// ─── aggregateDeliveryEvents ──────────────────────────────────────────────────

describe("aggregateDeliveryEvents", () => {
  it("counts a single sent event as 1 sent, 0 delivered, 0 opened, 0 bounced", () => {
    const { aggregate } = aggregateDeliveryEvents([makeEvent()]);
    expect(aggregate).toEqual({ sent: 1, delivered: 0, opened: 0, bounced: 0 });
  });

  it("deduplicated — sent + delivered for same email_id = 1 sent, 1 delivered", () => {
    const events: RawDeliveryEvent[] = [
      makeEvent({ eventType: "email.sent", trackingStatus: "sent", createdAt: "2026-11-01T10:00:00.000Z" }),
      makeEvent({ eventType: "email.delivered", trackingStatus: "sent", createdAt: "2026-11-01T10:01:00.000Z" }),
    ];
    const { aggregate } = aggregateDeliveryEvents(events);
    expect(aggregate).toEqual({ sent: 1, delivered: 1, opened: 0, bounced: 0 });
  });

  it("sent + delivered + opened for same email_id = 1 sent, 1 delivered, 1 opened", () => {
    const events: RawDeliveryEvent[] = [
      makeEvent({ eventType: "email.sent", trackingStatus: "sent" }),
      makeEvent({ eventType: "email.delivered", trackingStatus: "sent" }),
      makeEvent({ eventType: "email.opened", trackingStatus: "opened" }),
    ];
    const { aggregate } = aggregateDeliveryEvents(events);
    expect(aggregate).toEqual({ sent: 1, delivered: 1, opened: 1, bounced: 0 });
  });

  it("two different email_ids are counted separately", () => {
    const events: RawDeliveryEvent[] = [
      makeEvent({ emailId: "email-aaa", eventType: "email.sent", applicationId: "app-1" }),
      makeEvent({ emailId: "email-bbb", eventType: "email.sent", applicationId: "app-2" }),
    ];
    const { aggregate } = aggregateDeliveryEvents(events);
    expect(aggregate.sent).toBe(2);
    expect(aggregate.delivered).toBe(0);
  });

  it("bounced event sets bounced count", () => {
    const { aggregate } = aggregateDeliveryEvents([
      makeEvent({ eventType: "email.bounced", trackingStatus: "bounced" }),
    ]);
    expect(aggregate).toEqual({ sent: 1, delivered: 0, opened: 0, bounced: 1 });
  });

  it("complained event counts as bounced", () => {
    const { aggregate } = aggregateDeliveryEvents([
      makeEvent({ eventType: "email.complained", trackingStatus: "complained" }),
    ]);
    expect(aggregate.bounced).toBe(1);
  });

  it("null email_id events are each treated as a unique email", () => {
    const events: RawDeliveryEvent[] = [
      makeEvent({ emailId: null, applicationId: "app-1", createdAt: "2026-11-01T10:00:00.000Z" }),
      makeEvent({ emailId: null, applicationId: "app-2", createdAt: "2026-11-01T11:00:00.000Z" }),
    ];
    const { aggregate } = aggregateDeliveryEvents(events);
    expect(aggregate.sent).toBe(2);
  });

  it("empty input returns all-zero aggregate", () => {
    const { aggregate } = aggregateDeliveryEvents([]);
    expect(aggregate).toEqual({ sent: 0, delivered: 0, opened: 0, bounced: 0 });
  });

  it("bestStatusByKey tracks the highest-rank status per email_id", () => {
    const events: RawDeliveryEvent[] = [
      makeEvent({ eventType: "email.sent", trackingStatus: "sent" }),
      makeEvent({ eventType: "email.opened", trackingStatus: "opened" }),
    ];
    const { bestStatusByKey } = aggregateDeliveryEvents(events);
    expect(bestStatusByKey.get("email-aaa")?.status).toBe("opened");
  });

  it("bestStatusByKey does not downgrade from opened back to sent", () => {
    const events: RawDeliveryEvent[] = [
      makeEvent({ eventType: "email.opened", trackingStatus: "opened", createdAt: "2026-11-01T12:00:00.000Z" }),
      makeEvent({ eventType: "email.sent", trackingStatus: "sent", createdAt: "2026-11-01T10:00:00.000Z" }),
    ];
    const { bestStatusByKey } = aggregateDeliveryEvents(events);
    expect(bestStatusByKey.get("email-aaa")?.status).toBe("opened");
  });
});

// ─── aggregateCampaignRecipients ──────────────────────────────────────────────

describe("aggregateCampaignRecipients", () => {
  it("pending recipient contributes 0 to all counts", () => {
    const agg = aggregateCampaignRecipients([makeRecipient({ trackingStatus: "pending" })]);
    expect(agg).toEqual({ sent: 0, delivered: 0, opened: 0, bounced: 0 });
  });

  it("sent status = 1 sent, 0 others", () => {
    const agg = aggregateCampaignRecipients([makeRecipient({ trackingStatus: "sent" })]);
    expect(agg).toEqual({ sent: 1, delivered: 0, opened: 0, bounced: 0 });
  });

  it("delivered status = 1 sent, 1 delivered", () => {
    const agg = aggregateCampaignRecipients([makeRecipient({ trackingStatus: "delivered" })]);
    expect(agg).toEqual({ sent: 1, delivered: 1, opened: 0, bounced: 0 });
  });

  it("opened status = 1 sent, 1 opened", () => {
    const agg = aggregateCampaignRecipients([makeRecipient({ trackingStatus: "opened" })]);
    expect(agg).toEqual({ sent: 1, delivered: 0, opened: 1, bounced: 0 });
  });

  it("bounced status = 0 sent, 1 bounced", () => {
    const agg = aggregateCampaignRecipients([makeRecipient({ trackingStatus: "bounced" })]);
    expect(agg).toEqual({ sent: 0, delivered: 0, opened: 0, bounced: 1 });
  });

  it("complained status = 0 sent, 1 bounced", () => {
    const agg = aggregateCampaignRecipients([makeRecipient({ trackingStatus: "complained" })]);
    expect(agg).toEqual({ sent: 0, delivered: 0, opened: 0, bounced: 1 });
  });

  it("empty input returns all-zero aggregate", () => {
    expect(aggregateCampaignRecipients([])).toEqual({ sent: 0, delivered: 0, opened: 0, bounced: 0 });
  });

  it("mixed statuses are summed correctly", () => {
    const agg = aggregateCampaignRecipients([
      makeRecipient({ id: "r1", trackingStatus: "opened" }),
      makeRecipient({ id: "r2", trackingStatus: "delivered" }),
      makeRecipient({ id: "r3", trackingStatus: "bounced" }),
      makeRecipient({ id: "r4", trackingStatus: "pending" }),
    ]);
    expect(agg).toEqual({ sent: 2, delivered: 1, opened: 1, bounced: 1 });
  });
});

// ─── mergeAggregates ─────────────────────────────────────────────────────────

describe("mergeAggregates", () => {
  it("sums each field independently", () => {
    const a = { sent: 3, delivered: 2, opened: 1, bounced: 1 };
    const b = { sent: 5, delivered: 4, opened: 2, bounced: 0 };
    expect(mergeAggregates(a, b)).toEqual({ sent: 8, delivered: 6, opened: 3, bounced: 1 });
  });

  it("merging with zero is identity", () => {
    const a = { sent: 2, delivered: 1, opened: 1, bounced: 0 };
    const zero = { sent: 0, delivered: 0, opened: 0, bounced: 0 };
    expect(mergeAggregates(a, zero)).toEqual(a);
  });
});

// ─── buildApplicationActivityItems ───────────────────────────────────────────

describe("buildApplicationActivityItems", () => {
  it("returns one item per unique email_id (deduplicates sent + delivered)", () => {
    const events: RawDeliveryEvent[] = [
      makeEvent({ eventType: "email.sent", trackingStatus: "sent", createdAt: "2026-11-01T10:00:00.000Z" }),
      makeEvent({ eventType: "email.delivered", trackingStatus: "sent", createdAt: "2026-11-01T10:01:00.000Z" }),
    ];
    const resolved = new Map([["app-1", makeResolved()]]);
    const items = buildApplicationActivityItems(events, resolved, 20);
    expect(items).toHaveLength(1);
    expect(items[0].emailType).toBe("application_status");
  });

  it("resolves recipient email and name from application map", () => {
    const events = [makeEvent()];
    const resolved = new Map([["app-1", makeResolved({ seekerEmail: "a@b.com", seekerName: "Alex" })]]);
    const [item] = buildApplicationActivityItems(events, resolved, 20);
    expect(item.recipientEmail).toBe("a@b.com");
    expect(item.recipientName).toBe("Alex");
    expect(item.relatedLabel).toBe("Frontend Engineer");
  });

  it("handles missing application resolution gracefully (null fields)", () => {
    const events = [makeEvent({ applicationId: "app-unknown" })];
    const [item] = buildApplicationActivityItems(events, new Map(), 20);
    expect(item.recipientEmail).toBeNull();
    expect(item.recipientName).toBeNull();
    expect(item.relatedLabel).toBeNull();
  });

  it("uses best status (opened) even when sent event appears last in input", () => {
    const events: RawDeliveryEvent[] = [
      makeEvent({ eventType: "email.opened", trackingStatus: "opened", createdAt: "2026-11-01T12:00:00.000Z" }),
      makeEvent({ eventType: "email.sent", trackingStatus: "sent", createdAt: "2026-11-01T10:00:00.000Z" }),
    ];
    const resolved = new Map([["app-1", makeResolved()]]);
    const [item] = buildApplicationActivityItems(events, resolved, 20);
    expect(item.trackingStatus).toBe("opened");
  });

  it("skips events where both applicationId and emailId are null", () => {
    const events: RawDeliveryEvent[] = [
      makeEvent({ emailId: null, applicationId: null }),
    ];
    const items = buildApplicationActivityItems(events, new Map(), 20);
    expect(items).toHaveLength(0);
  });

  it("respects the limit", () => {
    const events: RawDeliveryEvent[] = Array.from({ length: 10 }, (_, i) =>
      makeEvent({ emailId: `email-${i}`, applicationId: `app-${i}` }),
    );
    const resolved = new Map(
      events.map((e) => [e.applicationId!, makeResolved({ applicationId: e.applicationId! })]),
    );
    const items = buildApplicationActivityItems(events, resolved, 3);
    expect(items).toHaveLength(3);
  });

  it("two different email_ids produce two items", () => {
    const events: RawDeliveryEvent[] = [
      makeEvent({ emailId: "email-aaa", applicationId: "app-1" }),
      makeEvent({ emailId: "email-bbb", applicationId: "app-2" }),
    ];
    const resolved = new Map([
      ["app-1", makeResolved({ applicationId: "app-1" })],
      ["app-2", makeResolved({ applicationId: "app-2", seekerEmail: "b@c.com" })],
    ]);
    const items = buildApplicationActivityItems(events, resolved, 20);
    expect(items).toHaveLength(2);
  });
});

// ─── buildCampaignActivityItems ───────────────────────────────────────────────

describe("buildCampaignActivityItems", () => {
  it("maps recipient fields to EmailActivityItem", () => {
    const [item] = buildCampaignActivityItems([makeRecipient()], 20);
    expect(item.emailType).toBe("campaign");
    expect(item.recipientEmail).toBe("seeker@example.com");
    expect(item.recipientName).toBe("Jane Seeker");
    expect(item.relatedLabel).toBe("November Outreach");
    expect(item.trackingStatus).toBe("sent");
    expect(item.applicationId).toBeNull();
    expect(item.campaignRecipientId).toBe("rcp-1");
  });

  it("uses sentAt as createdAt when available", () => {
    const r = makeRecipient({ sentAt: "2026-11-02T09:00:00.000Z" });
    const [item] = buildCampaignActivityItems([r], 20);
    expect(item.createdAt).toBe("2026-11-02T09:00:00.000Z");
  });

  it("falls back to createdAt when sentAt is null", () => {
    const r = makeRecipient({ sentAt: null, createdAt: "2026-11-02T08:00:00.000Z" });
    const [item] = buildCampaignActivityItems([r], 20);
    expect(item.createdAt).toBe("2026-11-02T08:00:00.000Z");
  });

  it("respects the limit", () => {
    const recipients = Array.from({ length: 10 }, (_, i) =>
      makeRecipient({ id: `rcp-${i}` }),
    );
    expect(buildCampaignActivityItems(recipients, 4)).toHaveLength(4);
  });

  it("empty input returns empty list", () => {
    expect(buildCampaignActivityItems([], 20)).toHaveLength(0);
  });
});

// ─── mergeAndSortActivityItems ────────────────────────────────────────────────

describe("mergeAndSortActivityItems", () => {
  it("sorts by createdAt descending", () => {
    const items = [
      { id: "a", emailType: "application_status" as const, createdAt: "2026-11-01T10:00:00.000Z", recipientEmail: null, recipientName: null, relatedLabel: null, trackingStatus: "sent", applicationId: null, campaignRecipientId: null },
      { id: "b", emailType: "campaign" as const, createdAt: "2026-11-02T10:00:00.000Z", recipientEmail: null, recipientName: null, relatedLabel: null, trackingStatus: "sent", applicationId: null, campaignRecipientId: null },
      { id: "c", emailType: "application_status" as const, createdAt: "2026-10-31T10:00:00.000Z", recipientEmail: null, recipientName: null, relatedLabel: null, trackingStatus: "sent", applicationId: null, campaignRecipientId: null },
    ];
    const sorted = mergeAndSortActivityItems(items, 10);
    expect(sorted.map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("caps result at the specified limit", () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      id: String(i),
      emailType: "campaign" as const,
      createdAt: `2026-11-0${(i % 9) + 1}T10:00:00.000Z`,
      recipientEmail: null,
      recipientName: null,
      relatedLabel: null,
      trackingStatus: "sent",
      applicationId: null,
      campaignRecipientId: null,
    }));
    expect(mergeAndSortActivityItems(items, 5)).toHaveLength(5);
  });

  it("empty input returns empty list", () => {
    expect(mergeAndSortActivityItems([], 10)).toHaveLength(0);
  });

  it("does not mutate the input array", () => {
    const items = [
      { id: "a", emailType: "application_status" as const, createdAt: "2026-11-01T10:00:00.000Z", recipientEmail: null, recipientName: null, relatedLabel: null, trackingStatus: "sent", applicationId: null, campaignRecipientId: null },
      { id: "b", emailType: "campaign" as const, createdAt: "2026-11-02T10:00:00.000Z", recipientEmail: null, recipientName: null, relatedLabel: null, trackingStatus: "sent", applicationId: null, campaignRecipientId: null },
    ];
    const copy = [...items];
    mergeAndSortActivityItems(items, 10);
    expect(items[0].id).toBe(copy[0].id); // original order preserved
  });
});

// ─── Integration-style: application + campaign combined ───────────────────────

describe("combined email activity (integration)", () => {
  it("app-status events + campaign recipients produce correct merged aggregate", () => {
    const events: RawDeliveryEvent[] = [
      makeEvent({ emailId: "e1", eventType: "email.sent", trackingStatus: "sent" }),
      makeEvent({ emailId: "e1", eventType: "email.delivered", trackingStatus: "sent" }),
      makeEvent({ emailId: "e1", eventType: "email.opened", trackingStatus: "opened" }),
    ];
    const recipients: RawCampaignRecipient[] = [
      makeRecipient({ id: "r1", trackingStatus: "sent" }),
      makeRecipient({ id: "r2", trackingStatus: "bounced" }),
    ];
    const { aggregate: appAgg } = aggregateDeliveryEvents(events);
    const campAgg = aggregateCampaignRecipients(recipients);
    const merged = mergeAggregates(appAgg, campAgg);

    // App: 1 sent, 1 delivered, 1 opened, 0 bounced
    // Campaign: 1 sent, 0 delivered, 0 opened, 1 bounced
    expect(merged).toEqual({ sent: 2, delivered: 1, opened: 1, bounced: 1 });
  });

  it("recent activity list contains both email types sorted newest-first", () => {
    const events: RawDeliveryEvent[] = [
      makeEvent({ emailId: "e1", createdAt: "2026-11-01T08:00:00.000Z" }),
    ];
    const resolved = new Map([["app-1", makeResolved()]]);
    const appItems = buildApplicationActivityItems(events, resolved, 20);

    const recipients: RawCampaignRecipient[] = [
      makeRecipient({ id: "r1", sentAt: "2026-11-02T10:00:00.000Z", createdAt: "2026-11-02T10:00:00.000Z" }),
    ];
    const campItems = buildCampaignActivityItems(recipients, 20);

    const merged = mergeAndSortActivityItems([...appItems, ...campItems], 20);
    expect(merged[0].emailType).toBe("campaign"); // newer
    expect(merged[1].emailType).toBe("application_status"); // older
  });
});
