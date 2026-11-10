import { supabase } from "@/integrations/supabase/client";
import type { CrmContactManualUpdate } from "@/lib/crm/contacts-list";
import { normalizeContactEmail } from "@/lib/crm/contacts";
import type {
  CrmCampaign,
  CrmCampaignRecipient,
  CrmCampaignStatus,
  CrmContact,
  CrmSegment,
  CrmSegmentFilter,
  CrmSegmentKind,
  CrmTrackingStatus,
} from "@/lib/crm/types";
import { parseSegmentFilter, parseSegmentType } from "@/lib/crm/segments";

type CrmSupabaseClient = typeof supabase;

/** Untyped PostgREST access for PROPOSED_0021 tables (not yet in generated Database types). */
function crmFrom(table: string, client: CrmSupabaseClient = supabase) {
  return (client as unknown as { from: (t: string) => ReturnType<typeof supabase.from> }).from(table);
}

export function mapContact(row: Record<string, unknown>): CrmContact {
  return {
    id: String(row.id),
    recruiterId: String(row.recruiter_id),
    companyId: (row.company_id as string | null) ?? null,
    seekerProfileId: (row.seeker_profile_id as string | null) ?? null,
    email: String(row.email),
    emailNormalized: String(row.email_normalized ?? normalizeContactEmail(String(row.email))),
    fullName: (row.full_name as string | null) ?? null,
    skills: Array.isArray(row.skills) ? (row.skills as string[]) : [],
    jobInterests: Array.isArray(row.job_interests) ? (row.job_interests as string[]) : [],
    jobCategories: Array.isArray(row.job_categories) ? (row.job_categories as string[]) : [],
    applicationStatus: (row.application_status as string | null) ?? null,
    segmentKind: (row.segment_kind as CrmSegmentKind) ?? "new",
    hubspotContactId: (row.hubspot_contact_id as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

export function mapSegment(row: Record<string, unknown>): CrmSegment {
  return {
    id: String(row.id),
    recruiterId: String(row.recruiter_id),
    name: String(row.name),
    kind: (row.kind as CrmSegmentKind) ?? "new",
    segmentType: parseSegmentType(row.segment_type),
    filter: parseSegmentFilter(row.filter_json),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

function mapCampaign(row: Record<string, unknown>): CrmCampaign {
  return {
    id: String(row.id),
    recruiterId: String(row.recruiter_id),
    segmentId: (row.segment_id as string | null) ?? null,
    name: String(row.name),
    subject: String(row.subject ?? ""),
    htmlBody: String(row.html_body ?? ""),
    status: (row.status as CrmCampaignStatus) ?? "draft",
    sendIdempotencyKey: (row.send_idempotency_key as string | null) ?? null,
    confirmedAt: (row.confirmed_at as string | null) ?? null,
    sentAt: (row.sent_at as string | null) ?? null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

function mapRecipient(row: Record<string, unknown>): CrmCampaignRecipient {
  return {
    id: String(row.id),
    campaignId: String(row.campaign_id),
    contactId: String(row.contact_id),
    recruiterId: String(row.recruiter_id),
    email: String(row.email),
    trackingStatus: (row.tracking_status as CrmTrackingStatus) ?? "pending",
    resendEmailId: (row.resend_email_id as string | null) ?? null,
    sendIdempotencyKey: (row.send_idempotency_key as string | null) ?? null,
    hubspotSyncOk: (row.hubspot_sync_ok as boolean | null) ?? null,
    hubspotSyncReason: (row.hubspot_sync_reason as string | null) ?? null,
    sentAt: (row.sent_at as string | null) ?? null,
    openedAt: (row.opened_at as string | null) ?? null,
  };
}

export async function listCrmContacts(
  recruiterId: string,
  client: CrmSupabaseClient = supabase,
): Promise<CrmContact[]> {
  const { data, error } = await crmFrom("crm_contacts", client)
    .select("*")
    .eq("recruiter_id", recruiterId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map(mapContact);
}

export async function getCrmContactById(
  contactId: string,
  client: CrmSupabaseClient = supabase,
): Promise<CrmContact | null> {
  const { data, error } = await crmFrom("crm_contacts", client).select("*").eq("id", contactId).maybeSingle();
  if (error) throw error;
  return data ? mapContact(data as Record<string, unknown>) : null;
}

export async function updateCrmContactFields(
  contactId: string,
  patch: CrmContactManualUpdate,
  client: CrmSupabaseClient = supabase,
): Promise<CrmContact> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.fullName !== undefined) row.full_name = patch.fullName;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.jobInterests !== undefined) row.job_interests = patch.jobInterests;
  if (patch.segmentKind !== undefined) row.segment_kind = patch.segmentKind;
  if (patch.skills !== undefined) row.skills = patch.skills;

  const { data, error } = await crmFrom("crm_contacts", client)
    .update(row)
    .eq("id", contactId)
    .select("*")
    .single();
  if (error) throw error;
  return mapContact(data as Record<string, unknown>);
}

export async function createCrmContact(
  input: {
    recruiterId: string;
    email: string;
    fullName?: string | null;
    companyId?: string | null;
    seekerProfileId?: string | null;
    skills?: string[];
    jobInterests?: string[];
    jobCategories?: string[];
    applicationStatus?: string | null;
    segmentKind?: CrmSegmentKind;
    notes?: string | null;
    hubspotContactId?: string | null;
  },
  client: CrmSupabaseClient = supabase,
): Promise<{ contact: CrmContact; created: boolean; duplicate: boolean }> {
  const emailNormalized = normalizeContactEmail(input.email);
  const payload = {
    recruiter_id: input.recruiterId,
    email: input.email.trim(),
    email_normalized: emailNormalized,
    full_name: input.fullName?.trim() || null,
    company_id: input.companyId ?? null,
    seeker_profile_id: input.seekerProfileId ?? null,
    skills: input.skills ?? [],
    job_interests: input.jobInterests ?? [],
    job_categories: input.jobCategories ?? [],
    application_status: input.applicationStatus ?? null,
    segment_kind: input.segmentKind ?? "new",
    notes: input.notes ?? null,
    hubspot_contact_id: input.hubspotContactId ?? null,
  };

  const { data, error } = await crmFrom("crm_contacts", client).insert(payload).select("*").maybeSingle();
  if (error) {
    if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
      const existing = await crmFrom("crm_contacts", client)
        .select("*")
        .eq("recruiter_id", input.recruiterId)
        .eq("email_normalized", emailNormalized)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (!existing.data) throw error;
      return { contact: mapContact(existing.data as Record<string, unknown>), created: false, duplicate: true };
    }
    throw error;
  }
  return { contact: mapContact(data as Record<string, unknown>), created: true, duplicate: false };
}

export async function listCrmSegments(
  recruiterId: string,
  client: CrmSupabaseClient = supabase,
): Promise<CrmSegment[]> {
  const { data, error } = await crmFrom("crm_segments", client)
    .select("*")
    .eq("recruiter_id", recruiterId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map(mapSegment);
}

export async function getCrmSegmentById(
  segmentId: string,
  client: CrmSupabaseClient = supabase,
): Promise<CrmSegment | null> {
  const { data, error } = await crmFrom("crm_segments", client).select("*").eq("id", segmentId).maybeSingle();
  if (error) throw error;
  return data ? mapSegment(data as Record<string, unknown>) : null;
}

export type CreateCrmSegmentInput = {
  recruiterId: string;
  name: string;
  kind: CrmSegmentKind;
  filter: CrmSegmentFilter;
  segmentType?: "filter" | "manual";
};

/** Insert payload for crm_segments (RLS requires recruiter_id = auth.uid() on the same Supabase client). */
export function buildCrmSegmentInsertRow(input: CreateCrmSegmentInput): Record<string, unknown> {
  const row: Record<string, unknown> = {
    recruiter_id: input.recruiterId,
    name: input.name.trim(),
    kind: input.kind,
    filter_json: input.filter,
  };
  if (input.segmentType === "manual") row.segment_type = "manual";
  return row;
}

export async function createCrmSegment(
  input: CreateCrmSegmentInput,
  client: CrmSupabaseClient = supabase,
): Promise<CrmSegment> {
  const row = buildCrmSegmentInsertRow(input);
  const { data, error } = await crmFrom("crm_segments", client).insert(row).select("*").single();
  if (error) throw error;
  return mapSegment(data as Record<string, unknown>);
}

export async function updateCrmSegmentName(
  segmentId: string,
  name: string,
  client: CrmSupabaseClient = supabase,
): Promise<CrmSegment> {
  const { data, error } = await crmFrom("crm_segments", client)
    .update({ name: name.trim(), updated_at: new Date().toISOString() })
    .eq("id", segmentId)
    .select("*")
    .single();
  if (error) throw error;
  return mapSegment(data as Record<string, unknown>);
}

export async function listCrmSegmentMemberContactIds(
  segmentId: string,
  client: CrmSupabaseClient = supabase,
): Promise<string[]> {
  const { data, error } = await crmFrom("crm_segment_members", client)
    .select("contact_id")
    .eq("segment_id", segmentId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data as { contact_id?: string }[]) ?? [])
    .map((r) => (typeof r.contact_id === "string" ? r.contact_id : ""))
    .filter(Boolean);
}

export async function insertCrmSegmentMembers(
  segmentId: string,
  recruiterId: string,
  contactIds: string[],
  client: CrmSupabaseClient = supabase,
): Promise<number> {
  if (contactIds.length === 0) return 0;
  const rows = contactIds.map((contactId) => ({
    segment_id: segmentId,
    contact_id: contactId,
    recruiter_id: recruiterId,
  }));
  const { data, error } = await crmFrom("crm_segment_members", client).insert(rows).select("id");
  if (error) {
    if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
      throw new Error("One or more contacts are already in this segment");
    }
    throw error;
  }
  return (data as unknown[])?.length ?? contactIds.length;
}

export async function deleteCrmSegmentMembers(
  segmentId: string,
  contactIds: string[],
  client: CrmSupabaseClient = supabase,
): Promise<void> {
  if (contactIds.length === 0) return;
  const { error } = await crmFrom("crm_segment_members", client)
    .delete()
    .eq("segment_id", segmentId)
    .in("contact_id", contactIds);
  if (error) throw error;
}

/** Map segment_id → member contact ids for a recruiter (manual segments). */
export async function listCrmSegmentMembersByRecruiter(
  recruiterId: string,
  client: CrmSupabaseClient = supabase,
): Promise<Map<string, string[]>> {
  const { data, error } = await crmFrom("crm_segment_members", client)
    .select("segment_id,contact_id")
    .eq("recruiter_id", recruiterId);
  if (error) throw error;
  const map = new Map<string, string[]>();
  for (const row of (data as { segment_id?: string; contact_id?: string }[]) ?? []) {
    const sid = row.segment_id;
    const cid = row.contact_id;
    if (!sid || !cid) continue;
    const list = map.get(sid) ?? [];
    list.push(cid);
    map.set(sid, list);
  }
  return map;
}

export async function listCrmCampaigns(recruiterId: string): Promise<CrmCampaign[]> {
  const { data, error } = await crmFrom("crm_campaigns")
    .select("*")
    .eq("recruiter_id", recruiterId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map(mapCampaign);
}

export async function getCrmCampaign(campaignId: string): Promise<CrmCampaign | null> {
  const { data, error } = await crmFrom("crm_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (error) throw error;
  return data ? mapCampaign(data as Record<string, unknown>) : null;
}

export async function createCrmCampaign(input: {
  recruiterId: string;
  name: string;
  segmentId?: string | null;
  subject?: string;
  htmlBody?: string;
}): Promise<CrmCampaign> {
  const { data, error } = await crmFrom("crm_campaigns")
    .insert({
      recruiter_id: input.recruiterId,
      name: input.name.trim(),
      segment_id: input.segmentId ?? null,
      subject: input.subject ?? "",
      html_body: input.htmlBody ?? "",
      status: "draft",
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapCampaign(data as Record<string, unknown>);
}

export async function updateCrmCampaign(
  campaignId: string,
  patch: Partial<{
    name: string;
    segmentId: string | null;
    subject: string;
    htmlBody: string;
    status: CrmCampaignStatus;
  }>,
): Promise<CrmCampaign> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.segmentId !== undefined) row.segment_id = patch.segmentId;
  if (patch.subject !== undefined) row.subject = patch.subject;
  if (patch.htmlBody !== undefined) row.html_body = patch.htmlBody;
  if (patch.status !== undefined) row.status = patch.status;

  const { data, error } = await crmFrom("crm_campaigns").update(row).eq("id", campaignId).select("*").single();
  if (error) throw error;
  return mapCampaign(data as Record<string, unknown>);
}

export async function listCrmRecipients(campaignId: string): Promise<CrmCampaignRecipient[]> {
  const { data, error } = await crmFrom("crm_campaign_recipients")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map(mapRecipient);
}

export async function listRecruiterRecipients(recruiterId: string): Promise<CrmCampaignRecipient[]> {
  const { data, error } = await crmFrom("crm_campaign_recipients")
    .select("*")
    .eq("recruiter_id", recruiterId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map(mapRecipient);
}

