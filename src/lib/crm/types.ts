export const CRM_SEGMENT_KINDS = ["new", "active", "placed"] as const;
export type CrmSegmentKind = (typeof CRM_SEGMENT_KINDS)[number];

export const CRM_TRACKING_STATUSES = [
  "pending",
  "sent",
  "delivered",
  "opened",
  "bounced",
  "complained",
  "replied",
  "applied",
] as const;
export type CrmTrackingStatus = (typeof CRM_TRACKING_STATUSES)[number];

export const CRM_CAMPAIGN_STATUSES = ["draft", "ready", "sending", "sent", "cancelled"] as const;
export type CrmCampaignStatus = (typeof CRM_CAMPAIGN_STATUSES)[number];

export const CRM_SEGMENT_TYPES = ["filter", "manual"] as const;
export type CrmSegmentType = (typeof CRM_SEGMENT_TYPES)[number];

export type CrmSegmentFilter = {
  skills?: string[];
  jobInterests?: string[];
  /** Job categories (Phase A); used by Phase B auto segments. */
  jobCategories?: string[];
  applicationStatuses?: string[];
  segmentKinds?: CrmSegmentKind[];
  query?: string;
};

export type CrmContact = {
  id: string;
  recruiterId: string;
  companyId: string | null;
  seekerProfileId: string | null;
  email: string;
  emailNormalized: string;
  fullName: string | null;
  skills: string[];
  jobInterests: string[];
  /** Categories from synced applications (union). */
  jobCategories: string[];
  applicationStatus: string | null;
  segmentKind: CrmSegmentKind;
  hubspotContactId: string | null;
  notes: string | null;
  createdAt: string;
};

export type CrmSegment = {
  id: string;
  recruiterId: string;
  name: string;
  kind: CrmSegmentKind;
  /** filter = filter_json audience; manual = explicit membership rows. */
  segmentType: CrmSegmentType;
  filter: CrmSegmentFilter;
  createdAt: string;
  updatedAt?: string;
};

export type CrmCampaign = {
  id: string;
  recruiterId: string;
  segmentId: string | null;
  name: string;
  subject: string;
  htmlBody: string;
  status: CrmCampaignStatus;
  sendIdempotencyKey: string | null;
  confirmedAt: string | null;
  sentAt: string | null;
  createdAt: string;
};

export type CrmCampaignRecipient = {
  id: string;
  campaignId: string;
  contactId: string;
  recruiterId: string;
  email: string;
  trackingStatus: CrmTrackingStatus;
  resendEmailId: string | null;
  sendIdempotencyKey: string | null;
  hubspotSyncOk: boolean | null;
  hubspotSyncReason: string | null;
  sentAt: string | null;
  openedAt: string | null;
};
