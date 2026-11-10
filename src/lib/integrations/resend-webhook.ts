import {
  createMemoryEmailDeliveryStore,
  type EmailDeliveryStore,
} from "@/lib/integrations/email-delivery-store";
import { mapResendEventToCrmTracking } from "@/lib/integrations/resend-event-mapping";
import { parseSvixHeaders, verifySvixSignature } from "@/lib/integrations/svix-verify";

export type ResendWebhookResult =
  | { status: 401; body: { ok: false; error: string } }
  | {
      status: 200;
      body: {
        ok: true;
        duplicate: boolean;
        trackingStatus: string | null;
        applicationId: string | null;
        campaignRecipientId: string | null;
      };
    }
  | { status: 400; body: { ok: false; error: string } };

function extractTag(data: Record<string, unknown>, name: string): string | null {
  const tags = data.tags;
  // Array format: [{ name: "application_id", value: "uuid" }] — used in tests and older payloads.
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (tag && typeof tag === "object") {
        const t = tag as { name?: unknown; value?: unknown };
        if (t.name === name && typeof t.value === "string" && t.value.trim()) {
          return t.value.trim();
        }
      }
    }
    return null;
  }
  // Object format: { application_id: "uuid" } — actual Resend webhook payload format.
  if (tags !== null && tags !== undefined && typeof tags === "object") {
    const v = (tags as Record<string, unknown>)[name];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function extractApplicationId(data: Record<string, unknown>): string | null {
  const fromTag = extractTag(data, "application_id");
  if (fromTag) return fromTag;
  const headers = data.headers;
  if (headers && typeof headers === "object") {
    const h = headers as Record<string, unknown>;
    const v = h["X-HireHub-Application-Id"] ?? h["x-hirehub-application-id"];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function extractCampaignRecipientId(data: Record<string, unknown>): string | null {
  const fromTag = extractTag(data, "campaign_recipient_id");
  if (fromTag) return fromTag;
  const headers = data.headers;
  if (headers && typeof headers === "object") {
    const h = headers as Record<string, unknown>;
    const v = h["X-HireHub-Campaign-Recipient-Id"] ?? h["x-hirehub-campaign-recipient-id"];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Handle a raw Resend/Svix webhook HTTP request body + headers.
 * Cron shared secrets must never be accepted here.
 */
export async function handleResendWebhookRequest(input: {
  secret: string;
  headers: Headers | Record<string, string | null | undefined>;
  rawBody: string;
  store?: EmailDeliveryStore;
  nowSec?: number;
}): Promise<ResendWebhookResult> {
  const store = input.store ?? createMemoryEmailDeliveryStore();
  const svix = parseSvixHeaders(input.headers);
  if (!svix) {
    return { status: 401, body: { ok: false, error: "Missing Svix signature headers" } };
  }

  if (!input.secret.trim()) {
    return { status: 401, body: { ok: false, error: "Webhook secret not configured" } };
  }

  const valid = verifySvixSignature({
    secret: input.secret,
    headers: svix,
    body: input.rawBody,
    nowSec: input.nowSec,
  });
  if (!valid) {
    return { status: 401, body: { ok: false, error: "Invalid Svix signature" } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { ok: false, error: "Invalid JSON body" } };
  }

  if (!parsed || typeof parsed !== "object") {
    return { status: 400, body: { ok: false, error: "Invalid webhook payload" } };
  }

  const root = parsed as Record<string, unknown>;
  const eventType = typeof root.type === "string" ? root.type : "unknown";
  const data =
    root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : {};
  const emailId = typeof data.email_id === "string" ? data.email_id : typeof data.id === "string" ? data.id : null;
  const applicationId = extractApplicationId(data);
  const campaignRecipientId = extractCampaignRecipientId(data);
  const crmTrackingStatus = mapResendEventToCrmTracking(eventType);

  const isNew = await store.recordIfNew({
    provider: "resend",
    eventId: svix.id,
    emailId,
    eventType,
    trackingStatus: crmTrackingStatus,
    applicationId,
    campaignRecipientId,
    payloadMeta: {
      type: eventType,
      emailId,
      applicationId,
      campaignRecipientId,
    },
  });

  const tracking =
    campaignRecipientId && crmTrackingStatus !== "other"
      ? await store.getCampaignRecipientTracking(campaignRecipientId)
      : applicationId &&
          (crmTrackingStatus === "sent" ||
            crmTrackingStatus === "delivered" ||
            crmTrackingStatus === "opened")
        ? await store.getTracking(applicationId)
        : null;

  return {
    status: 200,
    body: {
      ok: true,
      duplicate: !isNew,
      trackingStatus: tracking,
      applicationId,
      campaignRecipientId,
    },
  };
}
