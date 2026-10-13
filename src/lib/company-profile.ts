import { supabase } from "@/integrations/supabase/client";

export type CompanyFields = {
  name: string;
  industry: string | null;
  website: string | null;
};

/** Payload for creating a company — always pending until an admin approves. */
export function buildCreateCompanyPayload(recruiterId: string, fields: CompanyFields) {
  return {
    ...fields,
    recruiter_id: recruiterId,
    status: "pending" as const,
  };
}

/**
 * Fields a recruiter may update on their own company.
 * Status is omitted except when resubmitting a rejected company to pending.
 */
export function buildSaveCompanyPayload(
  fields: CompanyFields,
  options?: { resubmitForReview?: boolean },
) {
  return {
    name: fields.name,
    industry: fields.industry,
    website: fields.website,
    ...(options?.resubmitForReview
      ? { status: "pending" as const, rejection_reason: null }
      : {}),
  };
}

/**
 * Create a company as pending for admin approval.
 * Jobs separately stay pending until admin approves them.
 */
export async function createPendingCompany(recruiterId: string, fields: CompanyFields) {
  const { data: created, error: insertError } = await supabase
    .from("companies")
    .insert(buildCreateCompanyPayload(recruiterId, fields))
    .select("id,status")
    .single();
  if (insertError) throw insertError;
  if (created.status !== "pending") {
    throw new Error("Company was created with an unexpected status.");
  }
  return created.id;
}

/**
 * Update company profile fields only. Does not change approval status.
 */
export async function saveCompanyProfile(
  companyId: string,
  recruiterId: string,
  fields: CompanyFields,
  options?: { resubmitForReview?: boolean },
) {
  const { data, error } = await supabase
    .from("companies")
    .update(buildSaveCompanyPayload(fields, options))
    .eq("id", companyId)
    .eq("recruiter_id", recruiterId)
    .select("id,status");
  if (error) throw error;
  if (!data?.length) {
    throw new Error("Company could not be saved.");
  }
  return data[0];
}

/** @deprecated Prefer createPendingCompany. */
export const createActiveCompany = createPendingCompany;

/** @deprecated Prefer saveCompanyProfile. */
export const saveActiveCompany = saveCompanyProfile;

/*
 * OPTIONAL RLS HARDENING (NOT APPLIED — needs explicit approval before any migration):
 *
 * App code no longer self-approves, but owner UPDATE RLS still allows setting status=approved via API.
 * See drizzle/migrations/PROPOSED_0004_companies_owner_cannot_self_approve.sql
 */
