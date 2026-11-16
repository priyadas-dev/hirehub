/**
 * Bootstrap / renew Google Calendar events.watch channel.
 * Protected by CRON_SECRET (same pattern as RSVP poller cron).
 */

import { randomUUID } from "node:crypto";
import { INTEGRATION_ENV, readIntegrationEnv } from "@/lib/integrations/env";
import {
  resolveGoogleCalendarConfig,
  stopWatchChannel,
  watchInterviewCalendar,
} from "@/lib/integrations/google-calendar";
import { createGoogleCalendarWatchStore } from "@/lib/integrations/google-calendar-watch-store";
import { cronSecretsEqual } from "@/lib/integrations/interview-rsvp-sync.run";
import { isSupabaseServiceRoleConfigured } from "@/lib/oauth-signup-role";

export const GOOGLE_CALENDAR_WATCH_RENEW_CRON_PATH = "/api/cron/renew-google-calendar-watch";

/** Renew when fewer than this many ms remain (default 24h). */
export const GOOGLE_CALENDAR_WATCH_RENEW_LEAD_MS = 24 * 60 * 60 * 1000;

export type RenewWatchResult = {
  ok: boolean;
  action: "created" | "renewed" | "skipped" | "failed";
  channelId?: string;
  resourceId?: string;
  expirationMs?: number | null;
  code?: string;
};

export async function renewGoogleCalendarWatchFromEnv(options?: {
  env?: NodeJS.ProcessEnv;
  /** Force renew even if expiration is far away. */
  force?: boolean;
  nowMs?: number;
}): Promise<RenewWatchResult> {
  const env = options?.env ?? process.env;
  const nowMs = options?.nowMs ?? Date.now();

  if (!isSupabaseServiceRoleConfigured(env)) {
    return { ok: false, action: "failed", code: "service_role_not_configured" };
  }
  if (!resolveGoogleCalendarConfig(env)) {
    return { ok: false, action: "failed", code: "google_not_configured" };
  }

  const token = readIntegrationEnv(INTEGRATION_ENV.googleCalendarWebhookToken, env);
  const address = readIntegrationEnv(INTEGRATION_ENV.googleCalendarWebhookUrl, env);
  if (!token || token.length < 16) {
    return { ok: false, action: "failed", code: "webhook_token_not_configured" };
  }
  if (!address || !/^https:\/\//i.test(address)) {
    return { ok: false, action: "failed", code: "webhook_url_not_configured" };
  }

  const calendarId =
    readIntegrationEnv(INTEGRATION_ENV.googleCalendarId, env).trim() || "primary";

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const store = createGoogleCalendarWatchStore(supabaseAdmin as never);
  const existing = await store.getByCalendarId(calendarId);

  const stillFresh =
    existing?.expiration_ms != null &&
    existing.expiration_ms - nowMs > GOOGLE_CALENDAR_WATCH_RENEW_LEAD_MS;

  if (existing && stillFresh && !options?.force) {
    return {
      ok: true,
      action: "skipped",
      channelId: existing.channel_id,
      resourceId: existing.resource_id,
      expirationMs: existing.expiration_ms,
    };
  }

  if (existing) {
    await stopWatchChannel(
      { channelId: existing.channel_id, resourceId: existing.resource_id },
      { env },
    ).catch(() => null);
  }

  const channelId = randomUUID();
  const watched = await watchInterviewCalendar(
    { channelId, address, token },
    { env },
  );
  if (!watched.ok) {
    return { ok: false, action: "failed", code: watched.reason };
  }

  await store.upsertActive({
    channelId: watched.channel.channelId,
    resourceId: watched.channel.resourceId,
    calendarId: watched.channel.calendarId || calendarId,
    expirationMs: watched.channel.expirationMs,
  });

  return {
    ok: true,
    action: existing ? "renewed" : "created",
    channelId: watched.channel.channelId,
    resourceId: watched.channel.resourceId,
    expirationMs: watched.channel.expirationMs,
  };
}

/**
 * HTTP entry for bootstrap/renew.
 * POST only; `x-hirehub-cron-secret` must match `CRON_SECRET` (≥16 chars).
 * Counts/ids only — never returns the webhook token.
 */
export async function handleGoogleCalendarWatchRenewRequest(request: Request): Promise<Response> {
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  if (request.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  if (cronSecret.length < 16) {
    return json(500, { ok: false, error: "Server configuration error" });
  }

  const provided = request.headers.get("x-hirehub-cron-secret") ?? "";
  if (!cronSecretsEqual(provided, cronSecret)) {
    return json(401, { ok: false, error: "Unauthorized" });
  }

  let force = false;
  try {
    const raw = await request.json().catch(() => ({}));
    if (raw && typeof raw === "object") {
      const body = raw as Record<string, unknown>;
      if ("userId" in body || "role" in body || "email" in body) {
        return json(400, {
          ok: false,
          error: "Identity fields are not accepted in the request body",
        });
      }
      force = body["force"] === true;
    }
  } catch {
    /* empty body ok */
  }

  const result = await renewGoogleCalendarWatchFromEnv({ force });
  const status = result.ok
    ? 200
    : result.code === "google_not_configured" ||
        result.code === "service_role_not_configured" ||
        result.code === "webhook_token_not_configured" ||
        result.code === "webhook_url_not_configured"
      ? 503
      : 502;

  return json(status, {
    ok: result.ok,
    action: result.action,
    ...(result.channelId ? { channelId: result.channelId } : {}),
    ...(result.resourceId ? { resourceId: result.resourceId } : {}),
    ...(result.expirationMs != null ? { expirationMs: result.expirationMs } : {}),
    ...(result.code ? { code: result.code } : {}),
  });
}
