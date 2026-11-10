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
  const email = await sendApplicationStatusMail({
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
