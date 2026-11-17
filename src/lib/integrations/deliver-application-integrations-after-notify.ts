import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isSupabaseServiceRoleConfigured } from "@/lib/oauth-signup-role";
import { isAuthorizedApplicationNotifier } from "@/lib/application-notifier-authz";
import { deliverApplicationIntegrations } from "@/lib/integrations/deliver-application-integrations";

const requestSchema = z.object({
  applicationId: z.string().uuid(),
  status: z.enum(["applied", "shortlisted", "interview", "hired", "rejected"]),
});

export type DeliverApplicationIntegrationsAfterNotifyResult = {
  ok: true;
  emailSkipped?: boolean;
  hubspotSkipped?: boolean;
  emailReason?: string;
  hubspotReason?: string;
};

/**
 * Soft outbound Resend/HubSpot after in-app notify succeeds.
 *
 * Lives in a non-`.server.ts` module so the browser can import the createServerFn
 * RPC stub (same pattern as askJobAssistant). AuthZ + service-role seeker email
 * load still run only inside the server handler.
 */
export const deliverApplicationIntegrationsAfterNotify = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => requestSchema.parse(data))
  .handler(async ({ data, context }): Promise<DeliverApplicationIntegrationsAfterNotifyResult> => {
    try {
      if (!isSupabaseServiceRoleConfigured()) {
        return {
          ok: true,
          emailSkipped: true,
          hubspotSkipped: true,
          emailReason: "service_role_not_configured",
        };
      }

      const { data: profile } = await context.supabase
        .from("profiles")
        .select("id,role")
        .eq("id", context.userId)
        .maybeSingle();

      if (!profile) {
        return { ok: true, emailSkipped: true, hubspotSkipped: true, emailReason: "caller_profile_missing" };
      }

      // Application + job ownership via caller JWT (applications/jobs RLS).
      const { data: application } = await context.supabase
        .from("applications")
        .select("id,status,seeker_id,job_id,jobs!inner(id,title,recruiter_id,company_id)")
        .eq("id", data.applicationId)
        .maybeSingle();

      if (!application) {
        return { ok: true, emailSkipped: true, hubspotSkipped: true, emailReason: "application_not_found" };
      }

      const job = application.jobs as {
        id: string;
        title: string;
        recruiter_id: string;
        company_id: string;
      };

      if (
        !isAuthorizedApplicationNotifier({
          callerId: context.userId,
          callerRole: profile.role,
          jobRecruiterId: job.recruiter_id,
        })
      ) {
        return { ok: true, emailSkipped: true, hubspotSkipped: true, emailReason: "unauthorized" };
      }

      if (application.status !== data.status) {
        return { ok: true, emailSkipped: true, hubspotSkipped: true, emailReason: "status_mismatch" };
      }

      // After AuthZ: service role reads seeker email (profiles SELECT is own/admin only).
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: seeker } = await supabaseAdmin
        .from("profiles")
        .select("email,full_name")
        .eq("id", application.seeker_id)
        .maybeSingle();

      let companyName: string | null = null;
      if (job.company_id) {
        const { data: company } = await supabaseAdmin
          .from("companies")
          .select("name")
          .eq("id", job.company_id)
          .maybeSingle();
        companyName = company?.name ?? null;
      }

      // Status Resend mail is owned by notify-application-status EF (reliable host secrets).
      // This server fn keeps HubSpot soft-sync only to avoid duplicate emails.
      const result = await deliverApplicationIntegrations({
        applicationId: application.id,
        status: data.status,
        seekerEmail: seeker?.email ?? "",
        seekerFullName: seeker?.full_name?.trim() || "Candidate",
        jobTitle: job.title || "a job",
        companyName,
        skipEmail: true,
      });

      return {
        ok: true,
        emailSkipped: result.email.ok ? result.email.skipped : false,
        hubspotSkipped: result.hubspot.ok ? result.hubspot.skipped : false,
        emailReason: result.email.ok
          ? result.email.skipped
            ? result.email.reason
            : undefined
          : result.email.reason,
        hubspotReason: result.hubspot.ok
          ? result.hubspot.skipped
            ? result.hubspot.reason
            : undefined
          : result.hubspot.reason,
      };
    } catch {
      // Soft-fail: in-app notify already succeeded; integrations must not surface errors.
      return { ok: true, emailSkipped: true, hubspotSkipped: true, emailReason: "soft_fail" };
    }
  });
