/** Server-only integration env names (never VITE_). Values stay in host secrets / local .env. */

import { normalizeProcessEnvValue } from "@/lib/server-process-env";

export const INTEGRATION_ENV = {
  resendApiKey: "RESEND_API_KEY",
  resendFromEmail: "RESEND_FROM_EMAIL",
  contactFromEmail: "CONTACT_FROM_EMAIL",
  resendWebhookSecret: "RESEND_WEBHOOK_SECRET",
  hubspotAccessToken: "HUBSPOT_ACCESS_TOKEN",
  googleClientId: "GOOGLE_CLIENT_ID",
  googleClientSecret: "GOOGLE_CLIENT_SECRET",
  googleRefreshToken: "GOOGLE_REFRESH_TOKEN",
  googleCalendarId: "GOOGLE_CALENDAR_ID",
  /** Shared secret echoed as X-Goog-Channel-Token on Calendar push (never VITE_). */
  googleCalendarWebhookToken: "GOOGLE_CALENDAR_WEBHOOK_TOKEN",
  /** Public HTTPS webhook URL registered with events.watch. */
  googleCalendarWebhookUrl: "GOOGLE_CALENDAR_WEBHOOK_URL",
} as const;

export function readIntegrationEnv(
  name: (typeof INTEGRATION_ENV)[keyof typeof INTEGRATION_ENV],
  env: NodeJS.ProcessEnv = process.env,
): string {
  return normalizeProcessEnvValue(env[name]);
}

export function resolveResendFromEmail(env: NodeJS.ProcessEnv = process.env): string {
  return (
    readIntegrationEnv(INTEGRATION_ENV.resendFromEmail, env) ||
    readIntegrationEnv(INTEGRATION_ENV.contactFromEmail, env)
  );
}

/** Presence-only check — never returns secret values. */
export function isResendOutboundConfigured(env: NodeJS.ProcessEnv = process.env): {
  ok: boolean;
  missing: Array<"RESEND_API_KEY" | "RESEND_FROM_EMAIL" | "CONTACT_FROM_EMAIL">;
} {
  const apiKey = readIntegrationEnv(INTEGRATION_ENV.resendApiKey, env);
  const from = resolveResendFromEmail(env);
  const missing: Array<"RESEND_API_KEY" | "RESEND_FROM_EMAIL" | "CONTACT_FROM_EMAIL"> = [];
  if (!apiKey) missing.push("RESEND_API_KEY");
  if (!from) {
    missing.push("RESEND_FROM_EMAIL");
    missing.push("CONTACT_FROM_EMAIL");
  }
  return { ok: Boolean(apiKey && from), missing };
}
