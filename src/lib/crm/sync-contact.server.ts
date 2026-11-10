import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { syncCrmContactToHubSpot } from "@/lib/crm/hubspot-contact-sync";
import { canAccessCrmOwnedResource } from "@/lib/crm/ownership";

const requestSchema = z.object({
  contactId: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().nullable().optional(),
  segmentKind: z.enum(["new", "active", "placed"]).optional(),
});

/**
 * Soft HubSpot sync for a CRM contact. Never throws to the client for provider failures.
 */
export const softSyncCrmContactHubSpot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => requestSchema.parse(data))
  .handler(async ({ data, context }) => {
    try {
      const { data: profile } = await context.supabase
        .from("profiles")
        .select("id,role")
        .eq("id", context.userId)
        .maybeSingle();
      if (!profile) return { ok: true as const, skipped: true as const, reason: "no_profile" };

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (col: string, val: string) => {
              maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }>;
            };
          };
          update: (row: Record<string, unknown>) => {
            eq: (col: string, val: string) => PromiseLike<{ error: unknown }>;
          };
        };
      };

      const contactRes = await admin.from("crm_contacts").select("*").eq("id", data.contactId).maybeSingle();
      if (!contactRes.data) return { ok: true as const, skipped: true as const, reason: "contact_not_found" };

      if (
        !canAccessCrmOwnedResource({
          ownerRecruiterId: String(contactRes.data.recruiter_id),
          callerId: context.userId,
          callerRole: profile.role,
        })
      ) {
        return { ok: false as const, reason: "forbidden" };
      }

      const result = await syncCrmContactToHubSpot({
        email: data.email,
        fullName: data.fullName ?? null,
        contactId: data.contactId,
        segmentKind: data.segmentKind,
      });

      if (result.ok && !result.skipped && result.hubspotContactId) {
        await admin
          .from("crm_contacts")
          .update({ hubspot_contact_id: result.hubspotContactId })
          .eq("id", data.contactId);
      }

      return result;
    } catch {
      return { ok: false as const, reason: "soft_fail" };
    }
  });
