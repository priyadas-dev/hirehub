/**
 * Unified CRM email activity — server function.
 *
 * Security model:
 *   1. requireSupabaseAuth middleware: JWT required, userId always from server context.
 *   2. profiles.role read via JWT client (RLS) — never trusted from browser.
 *   3. Application ownership enforced via JWT client's RLS on applications + jobs!inner.
 *   4. supabaseAdmin (service role) imported only AFTER ownership is established, used
 *      only for tables whose RLS is admin-only (email_delivery_events, profiles).
 *   5. crm_campaign_recipients filtered by recruiter_id = callerId in the query.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isSupabaseServiceRoleConfigured } from "@/lib/oauth-signup-role";
import {
  aggregateCampaignRecipients,
  aggregateDeliveryEvents,
  buildApplicationActivityItems,
  buildCampaignActivityItems,
  mergeAggregates,
  mergeAndSortActivityItems,
  type EmailActivityAggregate,
  type EmailActivityItem,
  type RawCampaignRecipient,
  type RawDeliveryEvent,
  type ResolvedApplication,
} from "@/lib/integrations/email-activity";

// ─── Public result type ───────────────────────────────────────────────────────

export type CrmEmailActivityResult = {
  ok: true;
  aggregate: EmailActivityAggregate;
  recentActivity: EmailActivityItem[];
} | {
  ok: false;
  error: string;
  aggregate: EmailActivityAggregate;
  recentActivity: EmailActivityItem[];
};

const EMPTY_AGG: EmailActivityAggregate = { sent: 0, delivered: 0, opened: 0, bounced: 0 };

function emptyOk(): CrmEmailActivityResult {
  return { ok: true, aggregate: EMPTY_AGG, recentActivity: [] };
}

/** Max rows fetched per source before aggregation. */
const EVENT_LIMIT = 200;
/** Max items in the returned recent-activity list. */
const RECENT_LIMIT = 20;

// ─── Server function ──────────────────────────────────────────────────────────

export const fetchCrmEmailActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CrmEmailActivityResult> => {
    try {
      if (!isSupabaseServiceRoleConfigured()) return emptyOk();

      // ── 1. Identify caller role ───────────────────────────────────────────
      const { data: profile } = await context.supabase
        .from("profiles")
        .select("id,role")
        .eq("id", context.userId)
        .maybeSingle();

      if (!profile) return emptyOk();
      if (profile.role !== "recruiter" && profile.role !== "admin") return emptyOk();
      const isAdmin = profile.role === "admin";

      // ── 2. Application ownership check via JWT client (RLS enforces it) ───
      //    applications joined jobs!inner; filter by jobs.recruiter_id when recruiter.
      type AppRow = {
        id: string;
        seeker_id: string;
        jobs: { title: string; recruiter_id: string } | { title: string; recruiter_id: string }[] | null;
      };

      let appsQuery = context.supabase
        .from("applications")
        .select("id,seeker_id,jobs!inner(title,recruiter_id)");
      if (!isAdmin) {
        appsQuery = appsQuery.eq("jobs.recruiter_id", context.userId);
      }
      const { data: appRowsRaw } = await appsQuery;
      const appRows = (appRowsRaw ?? []) as AppRow[];

      // ── 3. Import admin client only after auth ────────────────────────────
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // ── 4a. Fetch delivery events (admin — table is admin-only RLS) ───────
      const appIds = appRows.map((r) => r.id);
      let rawEvents: RawDeliveryEvent[] = [];

      if (appIds.length > 0) {
        const { data: evtRows } = await supabaseAdmin
          .from("email_delivery_events")
          .select("email_id,event_type,tracking_status,application_id,created_at")
          .in("application_id", appIds)
          .order("created_at", { ascending: false })
          .limit(EVENT_LIMIT);

        rawEvents = ((evtRows ?? []) as Record<string, unknown>[]).map((r) => ({
          emailId: typeof r.email_id === "string" ? r.email_id : null,
          eventType: typeof r.event_type === "string" ? r.event_type : "unknown",
          trackingStatus: typeof r.tracking_status === "string" ? r.tracking_status : "other",
          applicationId: typeof r.application_id === "string" ? r.application_id : null,
          createdAt: typeof r.created_at === "string" ? r.created_at : new Date(0).toISOString(),
        }));
      }

      // ── 4b. Resolve seeker profiles (admin — profiles SELECT is own/admin) ─
      const resolvedByAppId = new Map<string, ResolvedApplication>();

      if (appIds.length > 0) {
        const seekerIds = [...new Set(appRows.map((r) => r.seeker_id).filter(Boolean))];
        const { data: profileRows } = await supabaseAdmin
          .from("profiles")
          .select("id,email,full_name")
          .in("id", seekerIds);

        const profileById = new Map<string, { email: string | null; fullName: string | null }>();
        for (const p of (profileRows ?? []) as { id: string; email: string | null; full_name: string | null }[]) {
          profileById.set(p.id, { email: p.email, fullName: p.full_name });
        }

        for (const app of appRows) {
          const job = Array.isArray(app.jobs) ? app.jobs[0] : app.jobs;
          const prof = profileById.get(app.seeker_id);
          resolvedByAppId.set(app.id, {
            applicationId: app.id,
            seekerEmail: prof?.email ?? null,
            seekerName: prof?.fullName ?? null,
            jobTitle: job?.title ?? null,
          });
        }
      }

      // ── 5. Fetch campaign recipients (admin, filtered by recruiter_id) ────
      let rawRecipients: RawCampaignRecipient[] = [];
      {
        // Use untyped admin access — crm tables are PROPOSED_0021, not in generated types.
        type AdminClient = { from: (t: string) => ReturnType<typeof supabaseAdmin.from> };
        const admin = supabaseAdmin as unknown as AdminClient;

        let rcpQuery = admin
          .from("crm_campaign_recipients")
          .select("id,email,tracking_status,resend_email_id,sent_at,created_at,recruiter_id,campaign_id,contact_id");
        if (!isAdmin) {
          rcpQuery = rcpQuery.eq("recruiter_id", context.userId);
        }
        const { data: rcpRows } = await rcpQuery
          .order("created_at", { ascending: false })
          .limit(EVENT_LIMIT);

        const rows = (rcpRows ?? []) as Record<string, unknown>[];

        // Resolve campaign names.
        const campaignIds = [...new Set(rows.map((r) => String(r.campaign_id)).filter(Boolean))];
        const campaignNameById = new Map<string, string>();
        if (campaignIds.length > 0) {
          const { data: camps } = await admin
            .from("crm_campaigns")
            .select("id,name")
            .in("id", campaignIds);
          for (const c of (camps ?? []) as { id: string; name: string }[]) {
            campaignNameById.set(c.id, c.name);
          }
        }

        // Resolve contact full names.
        const contactIds = [...new Set(rows.map((r) => String(r.contact_id)).filter(Boolean))];
        const contactNameById = new Map<string, string | null>();
        if (contactIds.length > 0) {
          const { data: contacts } = await admin
            .from("crm_contacts")
            .select("id,full_name")
            .in("id", contactIds);
          for (const c of (contacts ?? []) as { id: string; full_name: string | null }[]) {
            contactNameById.set(c.id, c.full_name);
          }
        }

        rawRecipients = rows.map((r) => ({
          id: String(r.id),
          email: String(r.email ?? ""),
          fullName: contactNameById.get(String(r.contact_id)) ?? null,
          trackingStatus: String(r.tracking_status ?? "pending"),
          campaignName: campaignNameById.get(String(r.campaign_id)) ?? "Campaign",
          campaignId: String(r.campaign_id),
          sentAt: typeof r.sent_at === "string" ? r.sent_at : null,
          createdAt: typeof r.created_at === "string" ? r.created_at : null,
        }));
      }

      // ── 6. Aggregate + merge ──────────────────────────────────────────────
      const { aggregate: appAgg } = aggregateDeliveryEvents(rawEvents);
      const campAgg = aggregateCampaignRecipients(rawRecipients);
      const aggregate = mergeAggregates(appAgg, campAgg);

      const appItems = buildApplicationActivityItems(rawEvents, resolvedByAppId, RECENT_LIMIT);
      const campItems = buildCampaignActivityItems(rawRecipients, RECENT_LIMIT);
      const recentActivity = mergeAndSortActivityItems([...appItems, ...campItems], RECENT_LIMIT);

      return { ok: true, aggregate, recentActivity };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Email activity load failed",
        aggregate: EMPTY_AGG,
        recentActivity: [],
      };
    }
  });
