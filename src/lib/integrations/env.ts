/** Server-only integration env names (never VITE_). Values stay in host secrets / local .env. */

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
} as const;

export function readIntegrationEnv(
  name: (typeof INTEGRATION_ENV)[keyof typeof INTEGRATION_ENV],
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env[name]?.trim() || "";
}

export function resolveResendFromEmail(env: NodeJS.ProcessEnv = process.env): string {
  return (
    readIntegrationEnv(INTEGRATION_ENV.resendFromEmail, env) ||
    readIntegrationEnv(INTEGRATION_ENV.contactFromEmail, env)
  );
}
