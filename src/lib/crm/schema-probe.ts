import { supabase } from "@/integrations/supabase/client";
import { isMissingSchemaError } from "@/lib/hirehub-storage";

let crmReadyCache: boolean | null = null;

export function resetCrmSchemaReadyCache() {
  crmReadyCache = null;
}

type LooseFrom = {
  from: (table: string) => {
    select: (cols: string) => {
      limit: (n: number) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

/**
 * Detect whether PROPOSED_0021 CRM tables are visible to PostgREST.
 * Honest false when missing — does not invent schema.
 */
export async function probeCrmSchemaReady(): Promise<boolean> {
  if (crmReadyCache !== null) return crmReadyCache;

  const client = supabase as unknown as LooseFrom;
  const { error } = await client.from("crm_contacts").select("id").limit(1);

  if (error && isMissingSchemaError(error.message)) {
    crmReadyCache = false;
    return false;
  }
  if (error && /could not find the table|relation .* does not exist|schema cache/i.test(error.message)) {
    crmReadyCache = false;
    return false;
  }

  // Other errors (auth) still mean table likely exists
  crmReadyCache = true;
  return true;
}

export const CRM_SCHEMA_PENDING_MESSAGE =
  "CRM tables are not applied yet. Ask an admin to apply PROPOSED_0020 (webhook events) and PROPOSED_0021 (CRM) when approved.";

let crmManualSegmentsReadyCache: boolean | null = null;

export function resetCrmManualSegmentsReadyCache() {
  crmManualSegmentsReadyCache = null;
}

/** True when PROPOSED_0026 manual segment tables/columns are visible to PostgREST. */
export async function probeCrmManualSegmentsReady(): Promise<boolean> {
  if (crmManualSegmentsReadyCache !== null) return crmManualSegmentsReadyCache;

  const client = supabase as unknown as LooseFrom;
  const { error } = await client.from("crm_segment_members").select("id").limit(1);

  if (error && isMissingSchemaError(error.message)) {
    crmManualSegmentsReadyCache = false;
    return false;
  }
  if (error && /could not find the table|relation .* does not exist|schema cache/i.test(error.message)) {
    crmManualSegmentsReadyCache = false;
    return false;
  }

  crmManualSegmentsReadyCache = true;
  return true;
}

export const CRM_MANUAL_SEGMENTS_PENDING_MESSAGE =
  "Manual segments need PROPOSED_0026 applied (segment_type + crm_segment_members). Apply in SQL Editor when approved, then reload the app.";
