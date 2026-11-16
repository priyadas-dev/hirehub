/**
 * Inbound Google Calendar push webhook (events.watch).
 *
 * Auth: timing-safe compare of X-Goog-Channel-Token to GOOGLE_CALENDAR_WEBHOOK_TOKEN,
 * plus channel id must match the registered row in google_calendar_watch_channels.
 * Google often sends an empty body — RSVP apply still uses getInterviewEvent.
 */

import { INTEGRATION_ENV, readIntegrationEnv } from "@/lib/integrations/env";
import { cronSecretsEqual } from "@/lib/integrations/interview-rsvp-sync.run";
import type { RsvpSyncBatchResult } from "@/lib/integrations/interview-rsvp-sync";

export const GOOGLE_CALENDAR_WEBHOOK_PATH = "/api/webhooks/google-calendar";

export type GoogleCalendarPushHeaders = {
  channelId: string;
  channelToken: string;
  resourceId: string;
  resourceState: string;
  resourceUri: string;
  messageNumber: string;
};

export function parseGoogleCalendarPushHeaders(
  headers: Headers | Record<string, string | null | undefined>,
): GoogleCalendarPushHeaders | null {
  const get = (name: string) => {
    if (headers instanceof Headers) {
      return (
        headers.get(name) ??
        headers.get(name.toLowerCase()) ??
        headers.get(name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase())
      );
    }
    const direct =
      headers[name] ??
      headers[name.toLowerCase()] ??
      headers[name.replace(/_/g, "-").toLowerCase()];
    return direct ?? null;
  };

  const channelId = (get("X-Goog-Channel-ID") ?? get("x-goog-channel-id") ?? "").trim();
  const channelToken = (get("X-Goog-Channel-Token") ?? get("x-goog-channel-token") ?? "").trim();
  const resourceId = (get("X-Goog-Resource-ID") ?? get("x-goog-resource-id") ?? "").trim();
  const resourceState = (get("X-Goog-Resource-State") ?? get("x-goog-resource-state") ?? "")
    .trim()
    .toLowerCase();
  const resourceUri = (get("X-Goog-Resource-URI") ?? get("x-goog-resource-uri") ?? "").trim();
  const messageNumber = (get("X-Goog-Message-Number") ?? get("x-goog-message-number") ?? "").trim();

  if (!channelId || !channelToken || !resourceState) return null;
  return { channelId, channelToken, resourceId, resourceState, resourceUri, messageNumber };
}

/** Extract Google event id from a Calendar resource URI when present. */
export function extractGoogleEventIdFromResourceUri(uri: string): string | null {
  const trimmed = uri.trim();
  if (!trimmed) return null;
  try {
    const path = new URL(trimmed).pathname;
    const marker = "/events/";
    const idx = path.lastIndexOf(marker);
    if (idx < 0) return null;
    const raw = decodeURIComponent(path.slice(idx + marker.length)).split("/")[0] ?? "";
    const id = raw.trim().toLowerCase();
    return id && id !== "watch" ? id : null;
  } catch {
    return null;
  }
}

export function verifyGoogleCalendarWebhookToken(input: {
  provided: string;
  expected: string;
}): boolean {
  return cronSecretsEqual(input.provided, input.expected);
}

export type GoogleCalendarWebhookDeps = {
  expectedToken: string;
  /** Return true when channel_id is the currently registered watch. */
  isKnownChannel: (channelId: string) => Promise<boolean>;
  /** Run RSVP sync after a change notification. */
  syncOnChange: (eventId: string | null) => Promise<RsvpSyncBatchResult>;
};

/**
 * Pure-ish handler for unit tests: header verify + state routing.
 * Returns HTTP status + counts-only JSON body (never tokens).
 */
export async function handleGoogleCalendarPush(input: {
  method: string;
  headers: Headers | Record<string, string | null | undefined>;
  deps: GoogleCalendarWebhookDeps;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (input.method !== "POST") {
    return { status: 405, body: { ok: false, error: "Method not allowed" } };
  }

  if (!input.deps.expectedToken || input.deps.expectedToken.length < 16) {
    return { status: 500, body: { ok: false, error: "Server configuration error" } };
  }

  const parsed = parseGoogleCalendarPushHeaders(input.headers);
  if (!parsed) {
    return { status: 400, body: { ok: false, error: "Missing Google channel headers" } };
  }

  if (
    !verifyGoogleCalendarWebhookToken({
      provided: parsed.channelToken,
      expected: input.deps.expectedToken,
    })
  ) {
    return { status: 401, body: { ok: false, error: "Unauthorized" } };
  }

  const known = await input.deps.isKnownChannel(parsed.channelId);
  if (!known) {
    return { status: 401, body: { ok: false, error: "Unknown channel" } };
  }

  // Initial handshake / sync message — acknowledge only.
  if (parsed.resourceState === "sync") {
    return { status: 200, body: { ok: true, state: "sync" } };
  }

  if (parsed.resourceState === "not_exists") {
    // Resource gone — run a small batch so cancelled interviews converge.
    const result = await input.deps.syncOnChange(null);
    return {
      status: 200,
      body: {
        ok: result.ok,
        state: "not_exists",
        scanned: result.scanned,
        updated: result.updated,
        cancelled: result.cancelled,
        unchanged: result.unchanged,
        errors: result.errors,
        ...(result.code ? { code: result.code } : {}),
      },
    };
  }

  // exists (and other change states): sync targeted event or small batch.
  const eventId = extractGoogleEventIdFromResourceUri(parsed.resourceUri);
  const result = await input.deps.syncOnChange(eventId);
  return {
    status: 200,
    body: {
      ok: result.ok,
      state: parsed.resourceState || "exists",
      scanned: result.scanned,
      updated: result.updated,
      cancelled: result.cancelled,
      unchanged: result.unchanged,
      errors: result.errors,
      ...(result.code ? { code: result.code } : {}),
    },
  };
}

/** Production HTTP entry — builds deps from env + service-role stores. */
export async function handleGoogleCalendarWebhookRequest(request: Request): Promise<Response> {
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const expectedToken = readIntegrationEnv(INTEGRATION_ENV.googleCalendarWebhookToken);
  if (!expectedToken || expectedToken.length < 16) {
    return json(500, { ok: false, error: "Server configuration error" });
  }

  const { createGoogleCalendarWatchStore } = await import(
    "@/lib/integrations/google-calendar-watch-store"
  );
  const { runInterviewRsvpSyncFromEnv, runInterviewRsvpSyncForEventFromEnv } = await import(
    "@/lib/integrations/interview-rsvp-sync.run"
  );
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const watchStore = createGoogleCalendarWatchStore(supabaseAdmin as never);

  const result = await handleGoogleCalendarPush({
    method: request.method,
    headers: request.headers,
    deps: {
      expectedToken,
      isKnownChannel: async (channelId) => {
        const row = await watchStore.getByChannelId(channelId);
        return Boolean(row);
      },
      syncOnChange: async (eventId) => {
        if (eventId) return runInterviewRsvpSyncForEventFromEnv(eventId);
        return runInterviewRsvpSyncFromEnv({ batchSize: 10 });
      },
    },
  });

  // Drain body if present (Google may send empty or opaque payload).
  await request.text().catch(() => "");

  return json(result.status, result.body);
}

/** Re-export for tests that want batch type without importing sync core. */
export type { RsvpSyncBatchResult };
