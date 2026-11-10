import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  applyRecipientTrackingEvent,
  markRecipientSent,
  summarizeCampaignTracking,
} from "@/lib/crm/campaigns";
import { sendCampaignEmailViaResend } from "@/lib/crm/campaign-mail";
import { assertCanMutateCrm } from "@/lib/crm/ownership";
import {
  displayCampaignRecipientTracking,
  isResendTestEmail,
  RESEND_TEST_RECIPIENTS,
} from "@/lib/crm/resend-test-fixtures";
import { createMemoryEmailDeliveryStore } from "@/lib/integrations/email-delivery-store";
import {
  mapResendEventToCrmTracking,
  mapResendEventToEmailDeliveryRow,
} from "@/lib/integrations/resend-event-mapping";
import { handleResendWebhookRequest } from "@/lib/integrations/resend-webhook";
import type { CrmCampaignRecipient } from "@/lib/crm/types";

const TEST_SECRET = "whsec_" + Buffer.from("resend-crm-test-secret!!").toString("base64");
const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";

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
    recruiterId: R1,
    email: "delivered@resend.dev",
    trackingStatus: "sent",
    resendEmailId: "re_test_1",
    sendIdempotencyKey: "key",
    hubspotSyncOk: null,
    hubspotSyncReason: null,
    sentAt: "2026-01-01T00:00:00.000Z",
    openedAt: null,
    ...overrides,
  };
}

describe("Resend event mapping (CRM vs delivery row)", () => {
  it("maps Resend webhook types per Resend docs", () => {
    expect(mapResendEventToCrmTracking("email.sent")).toBe("sent");
    expect(mapResendEventToCrmTracking("email.delivered")).toBe("delivered");
    expect(mapResendEventToCrmTracking("email.bounced")).toBe("bounced");
    expect(mapResendEventToCrmTracking("email.complained")).toBe("complained");
    expect(mapResendEventToEmailDeliveryRow("email.delivered")).toBe("sent");
    expect(mapResendEventToEmailDeliveryRow("email.complained")).toBe("complained");
  });

  it("lists official Resend simulator addresses", () => {
    expect(RESEND_TEST_RECIPIENTS.map((r) => r.email)).toEqual([
      "delivered@resend.dev",
      "bounced@resend.dev",
      "complained@resend.dev",
    ]);
    expect(isResendTestEmail(" Delivered@resend.dev ")).toBe(true);
    expect(isResendTestEmail("user@gmail.com")).toBe(false);
  });
});

describe("CRM campaign webhook tracking", () => {
  async function webhook(eventType: string, recipientId: string, eventId: string) {
    const store = createMemoryEmailDeliveryStore();
    const body = JSON.stringify({
      type: eventType,
      data: {
        email_id: "re_sim",
        tags: { campaign_recipient_id: recipientId },
      },
    });
    const ts = "1700000000";
    return handleResendWebhookRequest({
      secret: TEST_SECRET,
      headers: {
        "svix-id": eventId,
        "svix-timestamp": ts,
        "svix-signature": signBody(body, eventId, ts),
      },
      rawBody: body,
      store,
      nowSec: 1700000000,
    });
  }

  it("records delivered, bounced, and complained for campaign recipients", async () => {
    const recipientId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    const delivered = await webhook("email.delivered", recipientId, "evt_delivered");
    expect(delivered.status).toBe(200);
    if (delivered.status === 200) {
      expect(delivered.body.trackingStatus).toBe("delivered");
      expect(delivered.body.duplicate).toBe(false);
    }

    const bounced = await webhook("email.bounced", recipientId, "evt_bounced");
    expect(bounced.status).toBe(200);
    if (bounced.status === 200) expect(bounced.body.trackingStatus).toBe("bounced");

    const complained = await webhook("email.complained", recipientId, "evt_complained");
    expect(complained.status).toBe(200);
    if (complained.status === 200) expect(complained.body.trackingStatus).toBe("complained");
  });

  it("ignores duplicate svix-id replays", async () => {
    const store = createMemoryEmailDeliveryStore();
    const recipientId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const body = JSON.stringify({
      type: "email.delivered",
      data: { email_id: "re_sim", tags: { campaign_recipient_id: recipientId } },
    });
    const ts = "1700000000";
    const id = "evt_dup";
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
    expect(await store.count()).toBe(1);
  });

  it("returns 401 for invalid webhook signature", async () => {
    const result = await handleResendWebhookRequest({
      secret: TEST_SECRET,
      headers: {
        "svix-id": "msg_bad",
        "svix-timestamp": "1700000000",
        "svix-signature": "v1,deadbeef",
      },
      rawBody: "{}",
      nowSec: 1700000000,
    });
    expect(result.status).toBe(401);
  });
});

describe("CRM recipient tracking helpers", () => {
  it("marks sent on Resend API accept, delivered only from webhook event", () => {
    const pending = baseRecipient({ trackingStatus: "pending", resendEmailId: null, sentAt: null });
    const sent = markRecipientSent(pending, "re_abc");
    expect(sent.trackingStatus).toBe("sent");
    expect(sent.trackingStatus).not.toBe("delivered");

    const delivered = applyRecipientTrackingEvent(sent, "delivered");
    expect(delivered.trackingStatus).toBe("delivered");
  });

  it("summarizes bounced and complained separately", () => {
    const summary = summarizeCampaignTracking([
      baseRecipient({ trackingStatus: "sent" }),
      baseRecipient({ id: "2", trackingStatus: "delivered" }),
      baseRecipient({ id: "3", email: "bounced@resend.dev", trackingStatus: "bounced" }),
      baseRecipient({ id: "4", email: "complained@resend.dev", trackingStatus: "complained" }),
    ]);
    expect(summary).toMatchObject({
      sent: 1,
      delivered: 1,
      bounced: 1,
      complained: 1,
    });
  });

  it("shows failed label when send finished but Resend never accepted", () => {
    expect(
      displayCampaignRecipientTracking(
        { trackingStatus: "pending", resendEmailId: null },
        "sent",
      ),
    ).toBe("failed");
    expect(
      displayCampaignRecipientTracking(
        { trackingStatus: "pending", resendEmailId: null },
        "draft",
      ),
    ).toBe("pending");
  });

  it("denies cross-recruiter CRM mutation", () => {
    expect(
      assertCanMutateCrm({ ownerRecruiterId: R1, callerId: R2, callerRole: "recruiter" }).ok,
    ).toBe(false);
  });
});

describe("Resend campaign API submission", () => {
  it("returns message id on successful POST", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "re_ok_1" }),
    })) as unknown as typeof fetch;

    const result = await sendCampaignEmailViaResend({
      to: "delivered@resend.dev",
      subject: "Test",
      html: "<p>Hi</p>",
      campaignId: "camp",
      recipientId: "rec",
      contactId: "con",
      env: {
        RESEND_API_KEY: "re_test_key",
        CONTACT_FROM_EMAIL: "HireHub <onboarding@resend.dev>",
      },
      fetchImpl,
    });
    expect(result).toMatchObject({ ok: true, skipped: false, messageId: "re_ok_1" });
  });

  it("returns failure when Resend rejects the request", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 422,
      json: async () => ({ message: "Invalid" }),
    })) as unknown as typeof fetch;

    const result = await sendCampaignEmailViaResend({
      to: "bounced@resend.dev",
      subject: "Test",
      html: "<p>Hi</p>",
      campaignId: "camp",
      recipientId: "rec",
      contactId: "con",
      env: {
        RESEND_API_KEY: "re_test_key",
        CONTACT_FROM_EMAIL: "HireHub <onboarding@resend.dev>",
      },
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/^resend_/);
  });
});
