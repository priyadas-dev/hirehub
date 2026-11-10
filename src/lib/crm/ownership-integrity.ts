/**
 * Pure mirrors of PROPOSED_0022 composite FK rules.
 * Used by unit tests and in-memory CRM so cross-recruiter direct writes fail closed
 * without requiring a live Postgres apply.
 *
 * Postgres SQLSTATE for FK violations: 23503
 */

export const CRM_FK_VIOLATION = "23503" as const;

export type CrmOwnedRef = { id: string; recruiterId: string };

export type OwnershipIntegrityResult =
  | { ok: true }
  | { ok: false; code: typeof CRM_FK_VIOLATION; constraint: string; reason: string };

/** MATCH SIMPLE: null segment_id skips FK; non-null requires same recruiter. */
export function assertCampaignSegmentSameOwner(input: {
  campaignRecruiterId: string;
  segmentId: string | null | undefined;
  segment: CrmOwnedRef | null;
}): OwnershipIntegrityResult {
  if (input.segmentId == null || input.segmentId === "") {
    return { ok: true };
  }
  if (!input.segment || input.segment.id !== input.segmentId) {
    return {
      ok: false,
      code: CRM_FK_VIOLATION,
      constraint: "crm_campaigns_segment_same_recruiter_fkey",
      reason: "Referenced segment does not exist",
    };
  }
  if (input.segment.recruiterId !== input.campaignRecruiterId) {
    return {
      ok: false,
      code: CRM_FK_VIOLATION,
      constraint: "crm_campaigns_segment_same_recruiter_fkey",
      reason: "Campaign segment_id belongs to another recruiter",
    };
  }
  return { ok: true };
}

export function assertRecipientCampaignSameOwner(input: {
  rowRecruiterId: string;
  campaignId: string;
  campaign: CrmOwnedRef | null;
}): OwnershipIntegrityResult {
  if (!input.campaign || input.campaign.id !== input.campaignId) {
    return {
      ok: false,
      code: CRM_FK_VIOLATION,
      constraint: "crm_recipients_campaign_same_recruiter_fkey",
      reason: "Referenced campaign does not exist",
    };
  }
  if (input.campaign.recruiterId !== input.rowRecruiterId) {
    return {
      ok: false,
      code: CRM_FK_VIOLATION,
      constraint: "crm_recipients_campaign_same_recruiter_fkey",
      reason: "Recipient recruiter_id does not match campaign owner",
    };
  }
  return { ok: true };
}

export function assertRecipientContactSameOwner(input: {
  rowRecruiterId: string;
  contactId: string;
  contact: CrmOwnedRef | null;
}): OwnershipIntegrityResult {
  if (!input.contact || input.contact.id !== input.contactId) {
    return {
      ok: false,
      code: CRM_FK_VIOLATION,
      constraint: "crm_recipients_contact_same_recruiter_fkey",
      reason: "Referenced contact does not exist",
    };
  }
  if (input.contact.recruiterId !== input.rowRecruiterId) {
    return {
      ok: false,
      code: CRM_FK_VIOLATION,
      constraint: "crm_recipients_contact_same_recruiter_fkey",
      reason: "Recipient recruiter_id does not match contact owner",
    };
  }
  return { ok: true };
}

/** Full recipient INSERT/UPDATE graph check (campaign + contact composites). */
export function assertRecipientOwnershipCohesion(input: {
  rowRecruiterId: string;
  campaignId: string;
  contactId: string;
  campaign: CrmOwnedRef | null;
  contact: CrmOwnedRef | null;
}): OwnershipIntegrityResult {
  const campaignCheck = assertRecipientCampaignSameOwner({
    rowRecruiterId: input.rowRecruiterId,
    campaignId: input.campaignId,
    campaign: input.campaign,
  });
  if (!campaignCheck.ok) return campaignCheck;
  return assertRecipientContactSameOwner({
    rowRecruiterId: input.rowRecruiterId,
    contactId: input.contactId,
    contact: input.contact,
  });
}

/**
 * Simulates a direct DB write attempting to occupy UNIQUE(campaign_id, contact_id)
 * for another tenant by stamping the attacker's recruiter_id (F10).
 * After 0022, composite FK rejects before the unique key can poison the owner.
 */
export function evaluateCrossRecruiterRecipientInsert(input: {
  attackerRecruiterId: string;
  victimCampaign: CrmOwnedRef;
  victimContact: CrmOwnedRef;
}): OwnershipIntegrityResult {
  return assertRecipientOwnershipCohesion({
    rowRecruiterId: input.attackerRecruiterId,
    campaignId: input.victimCampaign.id,
    contactId: input.victimContact.id,
    campaign: input.victimCampaign,
    contact: input.victimContact,
  });
}

/** Service-role tracking patch is allowed; retargeting ids with wrong owner is not. */
export function assertRecipientRetargetAllowed(input: {
  rowRecruiterId: string;
  nextCampaignId: string;
  nextContactId: string;
  nextCampaign: CrmOwnedRef | null;
  nextContact: CrmOwnedRef | null;
}): OwnershipIntegrityResult {
  return assertRecipientOwnershipCohesion({
    rowRecruiterId: input.rowRecruiterId,
    campaignId: input.nextCampaignId,
    contactId: input.nextContactId,
    campaign: input.nextCampaign,
    contact: input.nextContact,
  });
}
