import type { ApplicationStatus } from "@/components/status/status";
import { INTEGRATION_ENV, readIntegrationEnv } from "@/lib/integrations/env";

export function hubspotSyncIdempotencyKey(applicationId: string, status: ApplicationStatus): string {
  return `hubspot:sync:${applicationId}:${status}`;
}

export function splitFullName(fullName: string): { firstname: string; lastname: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstname: "Candidate", lastname: "" };
  if (parts.length === 1) return { firstname: parts[0]!, lastname: "" };
  return { firstname: parts[0]!, lastname: parts.slice(1).join(" ") };
}

export function buildHubSpotContactUpsertBody(input: {
  email: string;
  fullName: string;
  applicationId: string;
  jobTitle: string;
  status: ApplicationStatus;
  companyName?: string | null;
}): {
  idProperty: string;
  properties: Record<string, string>;
} {
  const { firstname, lastname } = splitFullName(input.fullName);
  return {
    idProperty: "email",
    properties: {
      email: input.email.trim().toLowerCase(),
      firstname,
      lastname,
      hirehub_application_id: input.applicationId,
      hirehub_job_title: input.jobTitle,
      hirehub_application_status: input.status,
      ...(input.companyName?.trim()
        ? { hirehub_company: input.companyName.trim() }
        : {}),
    },
  };
}

export type HubSpotSyncResult =
  | { ok: true; skipped: false; contactId: string | null; idempotencyKey: string }
  | { ok: true; skipped: true; reason: string; idempotencyKey: string }
  | { ok: false; reason: string; idempotencyKey: string };

const syncedKeys = new Set<string>();

export function resetHubSpotSyncIdempotencyForTests() {
  syncedKeys.clear();
}

/**
 * Upsert a HubSpot contact by email (CRM v3). Soft-skip when token missing.
 */
export async function syncApplicationToHubSpot(input: {
  applicationId: string;
  status: ApplicationStatus;
  seekerEmail: string;
  seekerFullName: string;
  jobTitle: string;
  companyName?: string | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<HubSpotSyncResult> {
  const env = input.env ?? process.env;
  const idempotencyKey = hubspotSyncIdempotencyKey(input.applicationId, input.status);
  if (syncedKeys.has(idempotencyKey)) {
    return { ok: true, skipped: true, reason: "already_synced", idempotencyKey };
  }

  const token = readIntegrationEnv(INTEGRATION_ENV.hubspotAccessToken, env);
  if (!token) {
    return { ok: true, skipped: true, reason: "provider_not_configured", idempotencyKey };
  }

  const email = input.seekerEmail.trim();
  if (!email.includes("@")) {
    return { ok: true, skipped: true, reason: "missing_seeker_email", idempotencyKey };
  }

  const body = buildHubSpotContactUpsertBody({
    email,
    fullName: input.seekerFullName,
    applicationId: input.applicationId,
    jobTitle: input.jobTitle,
    status: input.status,
    companyName: input.companyName,
  });

  const fetchImpl = input.fetchImpl ?? fetch;
  const url = `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(body.properties.email)}?idProperty=email`;
  const res = await fetchImpl(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties: body.properties }),
  });

  // If contact missing, create then retry is heavy — use upsert endpoint.
  if (res.status === 404) {
    const createRes = await fetchImpl("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties: body.properties }),
    });
    if (!createRes.ok) {
      return { ok: false, reason: `hubspot_http_${createRes.status}`, idempotencyKey };
    }
    let created: unknown = null;
    try {
      created = await createRes.json();
    } catch {
      created = null;
    }
    const contactId =
      created && typeof created === "object" && "id" in created
        ? String((created as { id: unknown }).id)
        : null;
    syncedKeys.add(idempotencyKey);
    return { ok: true, skipped: false, contactId, idempotencyKey };
  }

  if (!res.ok) {
    return { ok: false, reason: `hubspot_http_${res.status}`, idempotencyKey };
  }

  let updated: unknown = null;
  try {
    updated = await res.json();
  } catch {
    updated = null;
  }
  const contactId =
    updated && typeof updated === "object" && "id" in updated
      ? String((updated as { id: unknown }).id)
      : null;
  syncedKeys.add(idempotencyKey);
  return { ok: true, skipped: false, contactId, idempotencyKey };
}
