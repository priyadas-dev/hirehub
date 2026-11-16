import {
  INTEGRATION_ENV,
  isResendOutboundConfigured,
  readIntegrationEnv,
  resolveResendFromEmail,
} from "@/lib/integrations/env";
import { classifyResendFailure } from "@/lib/resend-errors";
import { ensureProcessEnvFromDotenv } from "@/lib/server-process-env";

export function buildCampaignEmailPayload(input: {
  from: string;
  to: string;
  subject: string;
  html: string;
  campaignId: string;
  recipientId: string;
  contactId: string;
}): {
  from: string;
  to: string[];
  subject: string;
  html: string;
  headers: Record<string, string>;
  tags: Array<{ name: string; value: string }>;
} {
  return {
    from: input.from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    headers: {
      "X-HireHub-Campaign-Id": input.campaignId,
      "X-HireHub-Campaign-Recipient-Id": input.recipientId,
      "X-HireHub-Contact-Id": input.contactId,
    },
    tags: [
      { name: "hirehub_kind", value: "crm_campaign" },
      { name: "campaign_id", value: input.campaignId },
      { name: "campaign_recipient_id", value: input.recipientId },
      { name: "contact_id", value: input.contactId },
    ],
  };
}

export type SendCampaignEmailResult =
  | { ok: true; skipped: false; messageId: string }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; reason: string };

export async function sendCampaignEmailViaResend(input: {
  to: string;
  subject: string;
  html: string;
  campaignId: string;
  recipientId: string;
  contactId: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<SendCampaignEmailResult> {
  if (!input.env) ensureProcessEnvFromDotenv();
  const env = input.env ?? process.env;
  const configured = isResendOutboundConfigured(env);
  if (!configured.ok) {
    return { ok: true, skipped: true, reason: "provider_not_configured" };
  }
  const apiKey = readIntegrationEnv(INTEGRATION_ENV.resendApiKey, env);
  const from = resolveResendFromEmail(env);
  if (!input.to.includes("@")) {
    return { ok: true, skipped: true, reason: "missing_recipient_email" };
  }

  const payload = buildCampaignEmailPayload({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    campaignId: input.campaignId,
    recipientId: input.recipientId,
    contactId: input.contactId,
  });

  const fetchImpl = input.fetchImpl ?? fetch;
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const kind = classifyResendFailure(res.status, body);
    return { ok: false, reason: `resend_${kind}` };
  }

  const messageId =
    body && typeof body === "object" && "id" in body && typeof (body as { id: unknown }).id === "string"
      ? (body as { id: string }).id
      : "unknown";

  return { ok: true, skipped: false, messageId };
}
