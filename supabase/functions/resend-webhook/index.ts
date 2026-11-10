/**
 * HireHub Edge Function: resend-webhook
 *
 * Inbound Resend delivery events. Auth is Svix signature only
 * (RESEND_WEBHOOK_SECRET). Cron shared secrets are never accepted.
 *
 * Idempotency: svix-id unique. When email_delivery_events exists (PROPOSED_0020),
 * inserts via service role; otherwise acknowledges after verify so Resend
 * does not retry storms when the table is not applied yet.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  buildWebhookRecipientPatch,
  priorStatusesForWebhookUpdate,
  type WebhookCrmTrackingStatus,
} from "./crm-tracking.ts";

const SVIX_TOLERANCE_SEC = 300;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeWebhookSecret(secret: string): Uint8Array {
  const raw = secret.trim();
  const withoutPrefix = raw.startsWith("whsec_") ? raw.slice("whsec_".length) : raw;
  const bin = atob(withoutPrefix);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]!);
  return btoa(s);
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function verifySvix(input: {
  secret: string;
  id: string;
  timestamp: string;
  signature: string;
  body: string;
  nowSec: number;
}): Promise<boolean> {
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(input.nowSec - ts) > SVIX_TOLERANCE_SEC) return false;

  let keyBytes: Uint8Array;
  try {
    keyBytes = decodeWebhookSecret(input.secret);
  } catch {
    return false;
  }

  const signedContent = `${input.id}.${input.timestamp}.${input.body}`;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(signedContent));
  const expected = bytesToBase64(mac);

  for (const part of input.signature.split(" ")) {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) continue;
    if (timingSafeEqualStr(sig, expected)) return true;
  }
  return false;
}

function mapCrmTracking(eventType: string): string {
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

/** PROPOSED_0020 CHECK constraint — no `delivered` column value; event_type retains detail. */
function mapDeliveryRowTracking(crmStatus: string): string {
  if (crmStatus === "delivered") return "sent";
  return crmStatus;
}

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
  return extractTag(data, "application_id");
}

function extractCampaignRecipientId(data: Record<string, unknown>): string | null {
  return extractTag(data, "campaign_recipient_id");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  // Explicitly reject cron-style shared secrets as webhook auth.
  if (req.headers.get("x-hirehub-cron-secret")) {
    return json(401, { ok: false, error: "Cron secret is not accepted for Resend webhooks" });
  }

  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET")?.trim() || "";
  if (!secret) {
    return json(401, { ok: false, error: "Webhook secret not configured" });
  }

  const svixId = req.headers.get("svix-id")?.trim() || "";
  const svixTimestamp = req.headers.get("svix-timestamp")?.trim() || "";
  const svixSignature = req.headers.get("svix-signature")?.trim() || "";
  if (!svixId || !svixTimestamp || !svixSignature) {
    return json(401, { ok: false, error: "Missing Svix signature headers" });
  }

  const rawBody = await req.text();
  const nowSec = Math.floor(Date.now() / 1000);
  const valid = await verifySvix({
    secret,
    id: svixId,
    timestamp: svixTimestamp,
    signature: svixSignature,
    body: rawBody,
    nowSec,
  });
  if (!valid) {
    return json(401, { ok: false, error: "Invalid Svix signature" });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  if (!parsed || typeof parsed !== "object") {
    return json(400, { ok: false, error: "Invalid webhook payload" });
  }

  const root = parsed as Record<string, unknown>;
  const eventType = typeof root.type === "string" ? root.type : "unknown";
  const data =
    root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : {};
  const emailId =
    typeof data.email_id === "string" ? data.email_id : typeof data.id === "string" ? data.id : null;
  const applicationId = extractApplicationId(data);
  const campaignRecipientId = extractCampaignRecipientId(data);
  const crmTrackingStatus = mapCrmTracking(eventType);
  const rowTrackingStatus = mapDeliveryRowTracking(crmTrackingStatus);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  let duplicate = false;
  if (supabaseUrl && serviceRoleKey) {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await admin.from("email_delivery_events").insert({
      provider: "resend",
      event_id: svixId,
      email_id: emailId,
      event_type: eventType,
      tracking_status: rowTrackingStatus,
      application_id: applicationId,
      campaign_recipient_id: campaignRecipientId,
      payload_meta: {
        type: eventType,
        emailId,
        applicationId,
        campaignRecipientId,
      },
    });

    if (error) {
      if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
        duplicate = true;
      }
      // Missing relation → table not applied yet; still 200 after verify.
    }

    // Monotonic CRM update: conditional on current tracking_status (safe under concurrent webhooks).
    if (!duplicate && campaignRecipientId && crmTrackingStatus !== "other") {
      const next = crmTrackingStatus as WebhookCrmTrackingStatus;
      const allowedPrior = priorStatusesForWebhookUpdate(next);
      if (allowedPrior.length > 0) {
        const patch = buildWebhookRecipientPatch(next);
        await admin
          .from("crm_campaign_recipients")
          .update(patch)
          .eq("id", campaignRecipientId)
          .in("tracking_status", [...allowedPrior]);
      }
    }
  }

  return json(200, {
    ok: true,
    duplicate,
    trackingStatus:
      (campaignRecipientId || applicationId) &&
      (crmTrackingStatus === "sent" ||
        crmTrackingStatus === "delivered" ||
        crmTrackingStatus === "opened" ||
        crmTrackingStatus === "bounced" ||
        crmTrackingStatus === "complained")
        ? crmTrackingStatus
        : null,
    applicationId,
    campaignRecipientId,
  });
});
