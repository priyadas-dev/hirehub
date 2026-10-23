/**
 * HireHub Edge Function: close-expired-jobs
 *
 * Scheduled / cron invoke only. Closes approved jobs past application_deadline
 * by calling SECURITY DEFINER RPC close_expired_approved_jobs (PROPOSED_0013).
 *
 * Auth layers:
 * 1) Header x-hirehub-cron-secret must match env CRON_SECRET (≥16 chars).
 * 2) RPC runs with SUPABASE_SERVICE_ROLE_KEY so auth.jwt()->>'role' = service_role,
 *    which is the only JWT role protect_job_status accepts for expiry auto-close
 *    (approved → closed with a past Asia/Dhaka deadline). Not a client GUC.
 *
 * Does not accept identity fields in the body.
 *
 * Schedule (after deploy + migration apply):
 *   Supabase Dashboard → Edge Functions → close-expired-jobs → Schedules
 *   Method POST; cron e.g. 15 18 * * * (≈ 00:15 Asia/Dhaka);
 *   header x-hirehub-cron-secret = <CRON_SECRET>; body {}
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

  // Reject identity smuggling in body if present.
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { ok: false, error: "Server configuration error" });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc("close_expired_approved_jobs");
  if (error) {
    return json(500, {
      ok: false,
      error: "Failed to close expired jobs",
      detail: error.message,
    });
  }

  const closedCount = typeof data === "number" ? data : Number(data) || 0;
  return json(200, {
    ok: true,
    closedCount,
    reason: "Expired approved jobs closed (Asia/Dhaka calendar)",
  });
});
