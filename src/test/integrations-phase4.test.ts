import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applicationStatusEmailIdempotencyKey,
  buildApplicationStatusEmailPayload,
  resetApplicationStatusMailIdempotencyForTests,
  sendApplicationStatusMail,
} from "@/lib/integrations/application-status-mail";
import { deliverApplicationIntegrations } from "@/lib/integrations/deliver-application-integrations";
import {
  createMemoryEmailDeliveryStore,
  mapResendEventToTracking,
} from "@/lib/integrations/email-delivery-store";
import { INTEGRATION_ENV } from "@/lib/integrations/env";
import {
  buildHubSpotContactUpsertBody,
  hubspotSyncIdempotencyKey,
  resetHubSpotSyncIdempotencyForTests,
  splitFullName,
  syncApplicationToHubSpot,
} from "@/lib/integrations/hubspot-sync";
import { handleResendWebhookRequest } from "@/lib/integrations/resend-webhook";
import { parseSvixHeaders, verifySvixSignature } from "@/lib/integrations/svix-verify";

const TEST_SECRET = "whsec_" + Buffer.from("phase4-test-secret-bytes!!").toString("base64");

function signBody(body: string, id: string, timestamp: string, secret = TEST_SECRET): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`, "utf8")
    .digest("base64");
  return `v1,${expected}`;
}

describe("svix-verify", () => {
  it("parses Svix headers", () => {
    expect(
      parseSvixHeaders({
        "svix-id": "msg_1",
        "svix-timestamp": "1700000000",
        "svix-signature": "v1,abc",
      }),
    ).toEqual({ id: "msg_1", timestamp: "1700000000", signature: "v1,abc" });
  });

  it("rejects missing headers", () => {
    expect(parseSvixHeaders({ "svix-id": "only" })).toBeNull();
  });

  it("accepts a valid signature within tolerance", () => {
    const body = JSON.stringify({ type: "email.opened" });
    const id = "msg_valid";
    const timestamp = "1700000000";
    const signature = signBody(body, id, timestamp);
    expect(
      verifySvixSignature({
        secret: TEST_SECRET,
        headers: { id, timestamp, signature },
        body,
        nowSec: 1700000000,
      }),
    ).toBe(true);
  });

  it("rejects wrong signature and stale timestamp", () => {
    const body = "{}";
    const id = "msg_bad";
    const timestamp = "1700000000";
    expect(
      verifySvixSignature({
        secret: TEST_SECRET,
        headers: { id, timestamp, signature: "v1,not-real" },
        body,
        nowSec: 1700000000,
      }),
    ).toBe(false);
    const signature = signBody(body, id, timestamp);
    expect(
      verifySvixSignature({
        secret: TEST_SECRET,
        headers: { id, timestamp, signature },
        body,
        nowSec: 1700000000 + 10_000,
      }),
    ).toBe(false);
  });
});

describe("resend-webhook handler", () => {
  it("returns 401 when Svix headers are missing", async () => {
    const result = await handleResendWebhookRequest({
      secret: TEST_SECRET,
      headers: {},
      rawBody: "{}",
    });
    expect(result.status).toBe(401);
  });

  it("returns 401 for invalid signature", async () => {
    const result = await handleResendWebhookRequest({
      secret: TEST_SECRET,
      headers: {
        "svix-id": "msg_x",
        "svix-timestamp": "1700000000",
        "svix-signature": "v1,deadbeef",
      },
      rawBody: "{}",
      nowSec: 1700000000,
    });
    expect(result.status).toBe(401);
  });

  it("records email.opened and is idempotent on replay", async () => {
    const store = createMemoryEmailDeliveryStore();
    const applicationId = "11111111-1111-4111-8111-111111111111";
    const body = JSON.stringify({
      type: "email.opened",
      data: {
        email_id: "re_123",
        tags: [{ name: "application_id", value: applicationId }],
      },
    });
    const id = "msg_open_1";
    const timestamp = "1700000000";
    const signature = signBody(body, id, timestamp);
    const headers = {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": signature,
    };

    const first = await handleResendWebhookRequest({
      secret: TEST_SECRET,
      headers,
      rawBody: body,
      store,
      nowSec: 1700000000,
    });
    expect(first.status).toBe(200);
    if (first.status === 200) {
      expect(first.body.duplicate).toBe(false);
      expect(first.body.trackingStatus).toBe("opened");
      expect(first.body.applicationId).toBe(applicationId);
    }
    expect(await store.count()).toBe(1);
    expect(await store.getTracking(applicationId)).toBe("opened");

    const second = await handleResendWebhookRequest({
      secret: TEST_SECRET,
      headers,
      rawBody: body,
      store,
      nowSec: 1700000000,
    });
    expect(second.status).toBe(200);
    if (second.status === 200) {
      expect(second.body.duplicate).toBe(true);
    }
    expect(await store.count()).toBe(1);
  });

  it("maps Resend event types to tracking statuses", () => {
    expect(mapResendEventToTracking("email.sent")).toBe("sent");
    expect(mapResendEventToTracking("email.delivered")).toBe("delivered");
    expect(mapResendEventToTracking("email.opened")).toBe("opened");
    expect(mapResendEventToTracking("email.bounced")).toBe("bounced");
    expect(mapResendEventToTracking("email.complained")).toBe("complained");
  });

  // Tag format tests — object format is what Resend actually sends in webhook payloads.
  it("extracts application_id from object-format tags (real Resend webhook format)", async () => {
    const store = createMemoryEmailDeliveryStore();
    const applicationId = "22222222-2222-4222-8222-222222222222";
    const body = JSON.stringify({
      type: "email.opened",
      data: {
        email_id: "re_obj_1",
        tags: { application_id: applicationId, hirehub_kind: "application_status" },
      },
    });
    const id = "msg_obj_open_1";
    const timestamp = "1700000000";
    const signature = signBody(body, id, timestamp);
    const result = await handleResendWebhookRequest({
      secret: TEST_SECRET,
      headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature },
      rawBody: body,
      store,
      nowSec: 1700000000,
    });
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.applicationId).toBe(applicationId);
      expect(result.body.trackingStatus).toBe("opened");
      expect(result.body.duplicate).toBe(false);
    }
    expect(await store.getTracking(applicationId)).toBe("opened");
  });

  it("extracts campaign_recipient_id from object-format tags", async () => {
    const store = createMemoryEmailDeliveryStore();
    const recipientId = "33333333-3333-4333-8333-333333333333";
    const body = JSON.stringify({
      type: "email.sent",
      data: {
        email_id: "re_obj_2",
        tags: { campaign_recipient_id: recipientId, hirehub_kind: "crm_campaign" },
      },
    });
    const id = "msg_obj_sent_2";
    const timestamp = "1700000000";
    const signature = signBody(body, id, timestamp);
    const result = await handleResendWebhookRequest({
      secret: TEST_SECRET,
      headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature },
      rawBody: body,
      store,
      nowSec: 1700000000,
    });
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.campaignRecipientId).toBe(recipientId);
      expect(result.body.trackingStatus).toBe("sent");
    }
    expect(await store.getCampaignRecipientTracking(recipientId)).toBe("sent");
  });

  it("array-format tags still work (backward compat)", async () => {
    const store = createMemoryEmailDeliveryStore();
    const applicationId = "44444444-4444-4444-8444-444444444444";
    const body = JSON.stringify({
      type: "email.bounced",
      data: {
        email_id: "re_arr_1",
        tags: [{ name: "application_id", value: applicationId }],
      },
    });
    const id = "msg_arr_bounce_1";
    const timestamp = "1700000000";
    const signature = signBody(body, id, timestamp);
    const result = await handleResendWebhookRequest({
      secret: TEST_SECRET,
      headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature },
      rawBody: body,
      store,
      nowSec: 1700000000,
    });
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.applicationId).toBe(applicationId);
      // trackingStatus in the response is derived from the store, which only
      // surfaces sent/opened for applicationId correlation; bounced yields null.
      expect(result.body.trackingStatus).toBeNull();
    }
  });

  it("returns null for missing tags field", async () => {
    const store = createMemoryEmailDeliveryStore();
    const body = JSON.stringify({
      type: "email.delivered",
      data: { email_id: "re_notag_1" },
    });
    const id = "msg_notag_1";
    const timestamp = "1700000000";
    const signature = signBody(body, id, timestamp);
    const result = await handleResendWebhookRequest({
      secret: TEST_SECRET,
      headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature },
      rawBody: body,
      store,
      nowSec: 1700000000,
    });
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.applicationId).toBeNull();
      expect(result.body.campaignRecipientId).toBeNull();
    }
  });

  it("returns null for object-format tags when the key is absent", async () => {
    const store = createMemoryEmailDeliveryStore();
    const body = JSON.stringify({
      type: "email.delivered",
      data: {
        email_id: "re_wrongkey_1",
        tags: { hirehub_kind: "application_status" }, // no application_id key
      },
    });
    const id = "msg_wrongkey_1";
    const timestamp = "1700000000";
    const signature = signBody(body, id, timestamp);
    const result = await handleResendWebhookRequest({
      secret: TEST_SECRET,
      headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature },
      rawBody: body,
      store,
      nowSec: 1700000000,
    });
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.applicationId).toBeNull();
    }
  });

  it("returns null for object-format tags when value is empty string", async () => {
    const store = createMemoryEmailDeliveryStore();
    const body = JSON.stringify({
      type: "email.sent",
      data: {
        email_id: "re_empty_1",
        tags: { application_id: "   " }, // whitespace-only value
      },
    });
    const id = "msg_empty_1";
    const timestamp = "1700000000";
    const signature = signBody(body, id, timestamp);
    const result = await handleResendWebhookRequest({
      secret: TEST_SECRET,
      headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature },
      rawBody: body,
      store,
      nowSec: 1700000000,
    });
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.applicationId).toBeNull();
    }
  });

  it("object-format tags: replay of same svix-id is idempotent", async () => {
    const store = createMemoryEmailDeliveryStore();
    const applicationId = "55555555-5555-4555-8555-555555555555";
    const body = JSON.stringify({
      type: "email.opened",
      data: { email_id: "re_obj_idem", tags: { application_id: applicationId } },
    });
    const id = "msg_obj_idem";
    const timestamp = "1700000000";
    const signature = signBody(body, id, timestamp);
    const headers = { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature };

    const first = await handleResendWebhookRequest({ secret: TEST_SECRET, headers, rawBody: body, store, nowSec: 1700000000 });
    expect(first.status).toBe(200);
    if (first.status === 200) expect(first.body.duplicate).toBe(false);

    const second = await handleResendWebhookRequest({ secret: TEST_SECRET, headers, rawBody: body, store, nowSec: 1700000000 });
    expect(second.status).toBe(200);
    if (second.status === 200) expect(second.body.duplicate).toBe(true);
    expect(await store.count()).toBe(1); // still only one event stored
  });
});

describe("application-status-mail", () => {
  beforeEach(() => {
    resetApplicationStatusMailIdempotencyForTests();
  });

  it("builds idempotency key and payload tags", () => {
    expect(applicationStatusEmailIdempotencyKey("a1", "shortlisted")).toBe(
      "email:application_status:a1:shortlisted",
    );
    const payload = buildApplicationStatusEmailPayload({
      from: "hirehub@example.com",
      to: "seeker@example.com",
      jobTitle: "Engineer",
      status: "shortlisted",
      applicationId: "11111111-1111-4111-8111-111111111111",
    });
    expect(payload.tags).toContainEqual({ name: "application_id", value: "11111111-1111-4111-8111-111111111111" });
    expect(payload.headers["X-HireHub-Status"]).toBe("shortlisted");
  });

  it("skips when Resend is not configured", async () => {
    const result = await sendApplicationStatusMail({
      applicationId: "11111111-1111-4111-8111-111111111111",
      status: "hired",
      seekerEmail: "a@b.com",
      jobTitle: "Role",
      env: {},
    });
    expect(result).toMatchObject({ ok: true, skipped: true, reason: "provider_not_configured" });
  });

  it("sends once then skips on process-local idempotency", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "re_abc" }),
    });
    const env = {
      [INTEGRATION_ENV.resendApiKey]: "re_test",
      [INTEGRATION_ENV.resendFromEmail]: "from@hirehub.test",
    };
    const input = {
      applicationId: "11111111-1111-4111-8111-111111111111",
      status: "interview" as const,
      seekerEmail: "seeker@example.com",
      jobTitle: "Dev",
      env,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    };
    const first = await sendApplicationStatusMail(input);
    expect(first).toMatchObject({ ok: true, skipped: false, messageId: "re_abc" });
    const second = await sendApplicationStatusMail(input);
    expect(second).toMatchObject({ ok: true, skipped: true, reason: "already_sent" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("hubspot-sync", () => {
  beforeEach(() => {
    resetHubSpotSyncIdempotencyForTests();
  });

  it("splits names and builds upsert body", () => {
    expect(splitFullName("Priya Sharma")).toEqual({ firstname: "Priya", lastname: "Sharma" });
    expect(hubspotSyncIdempotencyKey("app1", "hired")).toBe("hubspot:sync:app1:hired");
    const body = buildHubSpotContactUpsertBody({
      email: "a@b.com",
      fullName: "Priya Sharma",
      applicationId: "app1",
      jobTitle: "Eng",
      status: "hired",
      companyName: "Acme",
    });
    expect(body.properties.hirehub_application_status).toBe("hired");
    expect(body.properties.hirehub_company).toBe("Acme");
  });

  it("skips when HubSpot token missing", async () => {
    const result = await syncApplicationToHubSpot({
      applicationId: "11111111-1111-4111-8111-111111111111",
      status: "applied",
      seekerEmail: "a@b.com",
      seekerFullName: "A B",
      jobTitle: "Role",
      env: {},
    });
    expect(result).toMatchObject({ ok: true, skipped: true, reason: "provider_not_configured" });
  });

  it("PATCHes contact by email when configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "hs_1" }),
    });
    const result = await syncApplicationToHubSpot({
      applicationId: "11111111-1111-4111-8111-111111111111",
      status: "shortlisted",
      seekerEmail: "seeker@example.com",
      seekerFullName: "Seeker One",
      jobTitle: "Role",
      env: { [INTEGRATION_ENV.hubspotAccessToken]: "pat-test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ ok: true, skipped: false, contactId: "hs_1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("deliverApplicationIntegrations", () => {
  beforeEach(() => {
    resetApplicationStatusMailIdempotencyForTests();
    resetHubSpotSyncIdempotencyForTests();
  });

  it("soft-skips both providers when env empty", async () => {
    const result = await deliverApplicationIntegrations({
      applicationId: "11111111-1111-4111-8111-111111111111",
      status: "rejected",
      seekerEmail: "a@b.com",
      seekerFullName: "A",
      jobTitle: "Role",
      env: {},
    });
    expect(result.email).toMatchObject({ ok: true, skipped: true });
    expect(result.hubspot).toMatchObject({ ok: true, skipped: true });
  });

  it("skipEmail avoids Resend when notify EF already owns status mail", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "should_not_call" }),
    })) as unknown as typeof fetch;

    const result = await deliverApplicationIntegrations({
      applicationId: "11111111-1111-4111-8111-111111111111",
      status: "shortlisted",
      seekerEmail: "a@b.com",
      seekerFullName: "A",
      jobTitle: "Role",
      env: {
        RESEND_API_KEY: "re_test",
        CONTACT_FROM_EMAIL: "HireHub <onboarding@resend.dev>",
      },
      fetchImpl,
      skipEmail: true,
    });

    expect(result.email).toMatchObject({
      ok: true,
      skipped: true,
      reason: "handled_by_notify_edge_function",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
