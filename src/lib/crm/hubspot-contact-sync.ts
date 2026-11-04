import { INTEGRATION_ENV, readIntegrationEnv } from "@/lib/integrations/env";
import { splitFullName } from "@/lib/integrations/hubspot-sync";

/**
 * Soft HubSpot upsert for CRM contacts. Failures never break HireHub CRM SoT.
 */
export async function syncCrmContactToHubSpot(input: {
  email: string;
  fullName: string | null;
  contactId: string;
  segmentKind?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; skipped: false; hubspotContactId: string | null }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; reason: string }
> {
  const env = input.env ?? process.env;
  const token = readIntegrationEnv(INTEGRATION_ENV.hubspotAccessToken, env);
  if (!token) {
    return { ok: true, skipped: true, reason: "provider_not_configured" };
  }

  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) {
    return { ok: true, skipped: true, reason: "missing_email" };
  }

  const { firstname, lastname } = splitFullName(input.fullName ?? "Candidate");
  const properties: Record<string, string> = {
    email,
    firstname,
    lastname,
    hirehub_crm_contact_id: input.contactId,
    ...(input.segmentKind ? { hirehub_segment_kind: input.segmentKind } : {}),
  };

  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const url = `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`;
    const res = await fetchImpl(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties }),
    });

    if (res.status === 404) {
      const createRes = await fetchImpl("https://api.hubapi.com/crm/v3/objects/contacts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ properties }),
      });
      if (!createRes.ok) {
        return { ok: false, reason: `hubspot_http_${createRes.status}` };
      }
      let created: unknown = null;
      try {
        created = await createRes.json();
      } catch {
        created = null;
      }
      const id =
        created && typeof created === "object" && "id" in created
          ? String((created as { id: unknown }).id)
          : null;
      return { ok: true, skipped: false, hubspotContactId: id };
    }

    if (!res.ok) {
      return { ok: false, reason: `hubspot_http_${res.status}` };
    }

    let updated: unknown = null;
    try {
      updated = await res.json();
    } catch {
      updated = null;
    }
    const id =
      updated && typeof updated === "object" && "id" in updated
        ? String((updated as { id: unknown }).id)
        : null;
    return { ok: true, skipped: false, hubspotContactId: id };
  } catch {
    return { ok: false, reason: "hubspot_network_error" };
  }
}
