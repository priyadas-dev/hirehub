import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { applyRecipientTrackingEvent } from "@/lib/crm/campaigns";
import type { CrmCampaignRecipient } from "@/lib/crm/types";
import { createMemoryEmailDeliveryStore } from "@/lib/integrations/email-delivery-store";
import { handleResendWebhookRequest } from "@/lib/integrations/resend-webhook";
import {
  mergeWebhookTrackingStatus,
  priorStatusesForWebhookUpdate,
} from "@/lib/crm/webhook-recipient-tracking";

const TEST_SECRET = "whsec_" + Buffer.from("webhook-tracking-test!!").toString("base64");

function signBody(body: string, id: string, timestamp: string) {
  const key = Buffer.from(TEST_SECRET.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`, "utf8").digest("base64");
  return `v1,${expected}`;
}

function baseRecipient(overrides: Partial<CrmCampaignRecipient> = {}): CrmCampaignRecipient {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    campaignId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    contactId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    recruiterId: "11111111-1111-4111-8111-111111111111",
    email: "delivered@resend.dev",
    trackingStatus: "pending",
    resendEmailId: null,
    sendIdempotencyKey: "key",
    hubspotSyncOk: null,
    hubspotSyncReason: null,
    sentAt: null,
    openedAt: null,
    ...overrides,
  };
}

/** Simulates one atomic DB update (compare-and-set on allowed prior statuses). */
function atomicWebhookApply(state: { trackingStatus: string }, event: Parameters<typeof mergeWebhookTrackingStatus>[1]) {
  const next = mergeWebhookTrackingStatus(state.trackingStatus, event);
  if (next) state.trackingStatus = next;
}

describe("priorStatusesForWebhookUpdate", () => {
  it("allows normal pending → sent → delivered", () => {
    expect(priorStatusesForWebhookUpdate("sent")).toEqual(["pending"]);
    expect(priorStatusesForWebhookUpdate("delivered")).toContain("sent");
    expect(mergeWebhookTrackingStatus("pending", "sent")).toBe("sent");
    expect(mergeWebhookTrackingStatus("sent", "delivered")).toBe("delivered");
  });

  it("allows pending → sent → bounced and complained", () => {
    expect(mergeWebhookTrackingStatus("sent", "bounced")).toBe("bounced");
    expect(mergeWebhookTrackingStatus("sent", "complained")).toBe("complained");
  });

  it("rejects late email.sent after terminal or advanced statuses", () => {
    expect(mergeWebhookTrackingStatus("delivered", "sent")).toBeNull();
    expect(mergeWebhookTrackingStatus("bounced", "sent")).toBeNull();
    expect(mergeWebhookTrackingStatus("complained", "sent")).toBeNull();
  });

  it("rejects email.sent after delivered when events arrive out of order", () => {
    const state = { trackingStatus: "pending" };
    atomicWebhookApply(state, "delivered");
    atomicWebhookApply(state, "sent");
    expect(state.trackingStatus).toBe("delivered");
  });

  it("rejects email.sent after bounced and complained", () => {
    for (const terminal of ["bounced", "complained"] as const) {
      const state = { trackingStatus: "sent" };
      atomicWebhookApply(state, terminal);
      atomicWebhookApply(state, "sent");
      expect(state.trackingStatus).toBe(terminal);
    }
  });
});

describe("concurrent webhook simulation", () => {
  it("keeps delivered when sent and delivered race from pending", async () => {
    const state = { trackingStatus: "pending" };
    await Promise.all([
      Promise.resolve().then(() => atomicWebhookApply(state, "delivered")),
      Promise.resolve().then(() => atomicWebhookApply(state, "sent")),
    ]);
    expect(state.trackingStatus).toBe("delivered");
  });

  it("eventually reaches delivered when sent wins first then delivered applies", async () => {
    const state = { trackingStatus: "pending" };
    atomicWebhookApply(state, "sent");
    atomicWebhookApply(state, "delivered");
    expect(state.trackingStatus).toBe("delivered");
  });
});

describe("applyRecipientTrackingEvent alignment", () => {
  it("does not downgrade delivered to sent", () => {
    const r = baseRecipient({ trackingStatus: "delivered", sentAt: "2026-01-01T00:00:00.000Z" });
    const after = applyRecipientTrackingEvent(r, "sent");
    expect(after.trackingStatus).toBe("delivered");
  });
});

describe("webhook idempotency (duplicate svix-id)", () => {
  it("ignores replay of the same event", async () => {
    const store = createMemoryEmailDeliveryStore();
    const recipientId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const body = JSON.stringify({
      type: "email.delivered",
      data: { email_id: "re_x", tags: { campaign_recipient_id: recipientId } },
    });
    const ts = "1700000000";
    const id = "evt_dup_tracking";
    const headers = {
      "svix-id": id,
      "svix-timestamp": ts,
      "svix-signature": signBody(body, id, ts),
    };
    const first = await handleResendWebhookRequest({
      secret: TEST_SECRET,
      headers,
      rawBody: body,
      store,
      nowSec: 1700000000,
    });
    const second = await handleResendWebhookRequest({
      secret: TEST_SECRET,
      headers,
      rawBody: body,
      store,
      nowSec: 1700000000,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    if (second.status === 200) expect(second.body.duplicate).toBe(true);
  });
});
