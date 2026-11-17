/**
 * HireHub Edge Function: notify-application-status
 *
 * Accepts { applicationId, status } only.
 * Identity / ownership are resolved from the caller's JWT + database — never from the body.
 *
 * Delivery:
 * 1) In-app notification for the seeker (idempotent via dedupe_key).
 * 2) Soft Resend status email after AuthZ (never fails the in-app notify path).
 *
 * Resend secrets (Edge Function secrets, not Vercel alone):
 *   RESEND_API_KEY + RESEND_FROM_EMAIL (or CONTACT_FROM_EMAIL fallback)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const APPLICATION_STATUSES = [
  "applied",
  "shortlisted",
  "interview",
  "hired",
  "rejected",
] as const;

type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Soft outbound Resend — never throws; never logs secret values. */
async function sendStatusEmailViaResend(input: {
  applicationId: string;
  status: ApplicationStatus;
  seekerEmail: string;
  jobTitle: string;
}): Promise<{ sent: boolean; skipped?: boolean; reason?: string; messageId?: string }> {
  const apiKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  const from =
    (Deno.env.get("RESEND_FROM_EMAIL") ?? "").trim() ||
    (Deno.env.get("CONTACT_FROM_EMAIL") ?? "").trim();
  const to = input.seekerEmail.trim();

  if (!apiKey || !from) {
    return { sent: false, skipped: true, reason: "provider_not_configured" };
  }
  if (!to || !to.includes("@")) {
    return { sent: false, skipped: true, reason: "missing_seeker_email" };
  }

  const title = input.jobTitle.trim() || "a job";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `HireHub: application update — ${title}`,
        html:
          `<p>Your application for <strong>${escapeHtml(title)}</strong> is now ` +
          `<strong>${escapeHtml(input.status)}</strong>.</p>` +
          `<p>Sign in to HireHub to view details.</p>`,
        headers: {
          "X-HireHub-Application-Id": input.applicationId,
          "X-HireHub-Status": input.status,
        },
        tags: [
          { name: "hirehub_kind", value: "application_status" },
          { name: "application_id", value: input.applicationId },
        ],
      }),
    });

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (!res.ok) {
      return {
        sent: false,
        reason: `resend_http_${res.status}`,
      };
    }

    const messageId =
      body && typeof body === "object" && "id" in body && typeof (body as { id: unknown }).id === "string"
        ? (body as { id: string }).id
        : "unknown";
    return { sent: true, messageId };
  } catch {
    return { sent: false, reason: "resend_network_error" };
  }
}

function parseBody(
  raw: unknown,
): { ok: true; applicationId: string; status: ApplicationStatus } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Request body must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;
  if ("userId" in body || "role" in body || "email" in body || "recruiterId" in body) {
    return { ok: false, error: "Identity fields are not accepted in the request body" };
  }
  const applicationId = body.applicationId;
  const status = body.status;
  if (typeof applicationId !== "string" || !UUID_RE.test(applicationId)) {
    return { ok: false, error: "applicationId must be a valid UUID" };
  }
  if (typeof status !== "string" || !(APPLICATION_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: "status must be a valid application status" };
  }
  return { ok: true, applicationId, status: status as ApplicationStatus };
}

function isAuthorizedNotifier(callerId: string, callerRole: string | null | undefined, jobRecruiterId: string) {
  if (!callerId || !jobRecruiterId) return false;
  if (callerRole === "admin") return true;
  return callerId === jobRecruiterId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json(401, { ok: false, error: "Missing or invalid Authorization header" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return json(500, { ok: false, error: "Server configuration error" });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const parsed = parseBody(rawBody);
  if (!parsed.ok) {
    return json(400, { ok: false, error: parsed.error });
  }

  // User-scoped client: JWT from the caller; never trust body identity claims.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return json(401, { ok: false, error: "Unauthorized" });
  }
  const callerId = userData.user.id;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,role")
    .eq("id", callerId)
    .maybeSingle();

  if (profileError || !profile) {
    return json(403, { ok: false, error: "Caller profile not found" });
  }

  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("id,status,seeker_id,job_id,jobs!inner(id,title,recruiter_id)")
    .eq("id", parsed.applicationId)
    .maybeSingle();

  if (appError) {
    return json(400, { ok: false, error: "Could not load application" });
  }
  if (!application) {
    return json(404, { ok: false, error: "Application not found" });
  }

  const job = application.jobs as { id: string; title: string; recruiter_id: string };
  if (!isAuthorizedNotifier(callerId, profile.role, job.recruiter_id)) {
    return json(403, { ok: false, error: "Only the job owner or an admin may send this notification" });
  }

  // Confirm the status already matches what the client reported (CRUD happens first via RLS).
  if (application.status !== parsed.status) {
    return json(409, {
      ok: false,
      error: "Application status does not match the requested notification status",
      currentStatus: application.status,
    });
  }

  const jobTitle = job.title || "a job";
  const dedupeKey = `application_status:${application.id}:${application.status}`;

  // Service role inserts only after JWT authz above. Matches trigger dedupe so retries are safe.
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: notifyError } = await admin.from("notifications").upsert(
    {
      recipient_id: application.seeker_id,
      type: "application_status",
      title: "Application update",
      body: `Your application for ${jobTitle} is now ${application.status}.`,
      entity_type: "application",
      entity_id: application.id,
      link_path: `/seeker/applications/${application.id}`,
      dedupe_key: dedupeKey,
    },
    { onConflict: "recipient_id,dedupe_key", ignoreDuplicates: true },
  );

  if (notifyError) {
    return json(500, {
      ok: false,
      error: "Failed to write in-app notification",
      detail: notifyError.message,
    });
  }

  // Soft Resend after in-app notify — same JWT AuthZ + service role seeker email load.
  let emailDelivery: {
    sent: boolean;
    skipped?: boolean;
    reason?: string;
    messageId?: string;
  } = { sent: false, skipped: true, reason: "not_attempted" };
  try {
    const { data: seeker } = await admin
      .from("profiles")
      .select("email")
      .eq("id", application.seeker_id)
      .maybeSingle();
    emailDelivery = await sendStatusEmailViaResend({
      applicationId: application.id,
      status: application.status as ApplicationStatus,
      seekerEmail: typeof seeker?.email === "string" ? seeker.email : "",
      jobTitle,
    });
  } catch {
    emailDelivery = { sent: false, reason: "soft_fail" };
  }

  return json(200, {
    ok: true,
    delivered: true,
    deliveryStatus: "delivered",
    reason: "In-app notification recorded for the seeker",
    emailDelivery,
    notification: {
      applicationId: application.id,
      status: application.status,
      seekerId: application.seeker_id,
      jobId: job.id,
      jobTitle: job.title,
    },
  });
});
