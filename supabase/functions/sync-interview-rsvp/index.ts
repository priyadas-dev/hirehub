/**
 * HireHub Edge Function: sync-interview-rsvp
 *
 * Scheduled / cron invoke only. Polls Google Calendar RSVP for scheduled+invited
 * interviews by delegating to the HireHub app server (single D1 sync core /
 * getInterviewEvent codepath). NO events.watch / push.
 *
 * Auth:
 * 1) Header x-hirehub-cron-secret must match env CRON_SECRET (≥16 chars).
 * 2) Forwards the same header to HIREHUB_APP_URL/api/cron/sync-interview-rsvp.
 *
 * Does not accept identity fields in the body.
 * Response: counts only { ok, scanned, updated, cancelled, unchanged, errors [, code] }.
 *
 * Edge secrets (NAMES only — set in D3, never commit values):
 *   CRON_SECRET
 *   HIREHUB_APP_URL   (e.g. https://your-app.vercel.app — no trailing slash)
 *
 * App host must already have (for D1 runner):
 *   CRON_SECRET (same value), GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 *   GOOGLE_REFRESH_TOKEN, GOOGLE_CALENDAR_ID (optional), SUPABASE_URL,
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Schedule (after D3 secrets): every 5–15 minutes, Method POST, body {}.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hirehub-cron-secret",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function secretsEqual(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || cronSecret.length < 16) {
    return json(500, { ok: false, error: "Server configuration error" });
  }

  const provided = req.headers.get("x-hirehub-cron-secret") ?? "";
  if (!secretsEqual(provided, cronSecret)) {
    return json(401, { ok: false, error: "Unauthorized" });
  }

  try {
    const raw = await req.json().catch(() => ({}));
    if (raw && typeof raw === "object") {
      const body = raw as Record<string, unknown>;
      if ("userId" in body || "role" in body || "email" in body) {
        return json(400, {
          ok: false,
          error: "Identity fields are not accepted in the request body",
        });
      }
    }
  } catch {
    /* empty body is fine */
  }

  const appUrl = (Deno.env.get("HIREHUB_APP_URL") ?? "").trim().replace(/\/$/, "");
  if (!appUrl) {
    return json(500, {
      ok: false,
      error: "Server configuration error",
      code: "hirehub_app_url_missing",
    });
  }

  const target = `${appUrl}/api/cron/sync-interview-rsvp`;
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hirehub-cron-secret": cronSecret,
      },
      body: "{}",
    });
  } catch {
    return json(502, {
      ok: false,
      scanned: 0,
      updated: 0,
      cancelled: 0,
      unchanged: 0,
      errors: 1,
      code: "upstream_unreachable",
    });
  }

  let payload: Record<string, unknown> = {};
  try {
    const parsed = await upstream.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    return json(502, {
      ok: false,
      scanned: 0,
      updated: 0,
      cancelled: 0,
      unchanged: 0,
      errors: 1,
      code: "upstream_invalid_json",
    });
  }

  // Counts-only passthrough — drop any unexpected keys.
  return json(upstream.status, {
    ok: payload.ok === true,
    scanned: typeof payload.scanned === "number" ? payload.scanned : 0,
    updated: typeof payload.updated === "number" ? payload.updated : 0,
    cancelled: typeof payload.cancelled === "number" ? payload.cancelled : 0,
    unchanged: typeof payload.unchanged === "number" ? payload.unchanged : 0,
    errors: typeof payload.errors === "number" ? payload.errors : 0,
    ...(typeof payload.code === "string" ? { code: payload.code } : {}),
  });
});
