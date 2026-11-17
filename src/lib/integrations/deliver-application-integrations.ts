import type { ApplicationStatus } from "@/components/status/status";
import { sendApplicationStatusMail } from "@/lib/integrations/application-status-mail";
import { syncApplicationToHubSpot } from "@/lib/integrations/hubspot-sync";

export type DeliverApplicationIntegrationsInput = {
  applicationId: string;
  status: ApplicationStatus;
  seekerEmail: string;
  seekerFullName: string;
  jobTitle: string;
  companyName?: string | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /**
   * When true, skip Resend status mail (used after notify-application-status EF
   * already attempted outbound email — avoids duplicate sends).
   */
  skipEmail?: boolean;
};

/**
 * Best-effort outbound integrations after in-app notify succeeds.
 * Never throws for provider misconfig — callers treat as soft side effects.
 */
export async function deliverApplicationIntegrations(
  input: DeliverApplicationIntegrationsInput,
): Promise<{
  email: Awaited<ReturnType<typeof sendApplicationStatusMail>>;
  hubspot: Awaited<ReturnType<typeof syncApplicationToHubSpot>>;
}> {
  const email = input.skipEmail
    ? ({
        ok: true as const,
        skipped: true as const,
        reason: "handled_by_notify_edge_function",
        idempotencyKey: `email:application_status:${input.applicationId}:${input.status}`,
      } satisfies Awaited<ReturnType<typeof sendApplicationStatusMail>>)
    : await sendApplicationStatusMail({
        applicationId: input.applicationId,
        status: input.status,
        seekerEmail: input.seekerEmail,
        jobTitle: input.jobTitle,
        env: input.env,
        fetchImpl: input.fetchImpl,
      });

  const hubspot = await syncApplicationToHubSpot({
    applicationId: input.applicationId,
    status: input.status,
    seekerEmail: input.seekerEmail,
    seekerFullName: input.seekerFullName,
    jobTitle: input.jobTitle,
    companyName: input.companyName,
    env: input.env,
    fetchImpl: input.fetchImpl,
  });

  return { email, hubspot };
}
