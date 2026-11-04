import { contactMatchesFilter, filterContactsForRecruiter } from "@/lib/crm/contacts";
import type { CrmContact, CrmSegmentFilter, CrmSegmentKind } from "@/lib/crm/types";
import { CRM_SEGMENT_KINDS } from "@/lib/crm/types";
import type { ApplicationStatus } from "@/components/status/status";

export type CrmContactSource = "import" | "manual";

export function crmContactSource(contact: CrmContact): CrmContactSource {
  return contact.seekerProfileId ? "import" : "manual";
}

export function contactHasSyncedApplicantData(contact: CrmContact): boolean {
  return crmContactSource(contact) === "import";
}

export type CrmContactSortField = "name" | "email" | "createdAt" | "segmentKind" | "applicationStatus";
export type CrmContactSortDir = "asc" | "desc";

export type CrmContactListQuery = CrmSegmentFilter & {
  sortBy?: CrmContactSortField;
  sortDir?: CrmContactSortDir;
  page?: number;
  pageSize?: number;
};

export type CrmContactListPage = {
  contacts: CrmContact[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 25;

function sortKey(contact: CrmContact, field: CrmContactSortField): string {
  switch (field) {
    case "name":
      return (contact.fullName || contact.email).toLowerCase();
    case "email":
      return contact.emailNormalized;
    case "segmentKind":
      return contact.segmentKind;
    case "applicationStatus":
      return contact.applicationStatus ?? "";
    case "createdAt":
    default:
      return contact.createdAt;
  }
}

export function sortCrmContacts(
  contacts: CrmContact[],
  sortBy: CrmContactSortField = "createdAt",
  sortDir: CrmContactSortDir = "desc",
): CrmContact[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...contacts].sort((a, b) => {
    const ka = sortKey(a, sortBy);
    const kb = sortKey(b, sortBy);
    if (ka < kb) return -1 * dir;
    if (ka > kb) return 1 * dir;
    return a.id.localeCompare(b.id) * dir;
  });
}

export function paginateCrmContacts(
  contacts: CrmContact[],
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): CrmContactListPage {
  const safePageSize = Math.min(100, Math.max(1, pageSize));
  const total = contacts.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * safePageSize;
  return {
    contacts: contacts.slice(start, start + safePageSize),
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
  };
}

export function listCrmContactsPage(
  allContacts: CrmContact[],
  recruiterId: string,
  query: CrmContactListQuery = {},
): CrmContactListPage {
  const filtered = sortCrmContacts(
    filterContactsForRecruiter(allContacts, recruiterId, query),
    query.sortBy ?? "createdAt",
    query.sortDir ?? "desc",
  );
  return paginateCrmContacts(filtered, query.page ?? 1, query.pageSize ?? DEFAULT_PAGE_SIZE);
}

/** Distinct filter option values from a recruiter's contact list. */
export function collectContactFilterOptions(contacts: CrmContact[], recruiterId: string) {
  const owned = contacts.filter((c) => c.recruiterId === recruiterId);
  const skills = new Set<string>();
  const jobCategories = new Set<string>();
  const applicationStatuses = new Set<string>();
  for (const c of owned) {
    c.skills.forEach((s) => skills.add(s));
    c.jobCategories.forEach((s) => jobCategories.add(s));
    if (c.applicationStatus) applicationStatuses.add(c.applicationStatus);
  }
  return {
    skills: [...skills].sort((a, b) => a.localeCompare(b)),
    jobCategories: [...jobCategories].sort((a, b) => a.localeCompare(b)),
    applicationStatuses: [...applicationStatuses].sort((a, b) => a.localeCompare(b)),
    segmentKinds: [...CRM_SEGMENT_KINDS],
  };
}

export type CrmContactManualUpdate = {
  fullName?: string | null;
  notes?: string | null;
  jobInterests?: string[];
  segmentKind?: CrmSegmentKind;
  /** Only applied when contact is manual (no seeker profile link). */
  skills?: string[];
};

export type BuildManualUpdateResult =
  | { ok: true; patch: CrmContactManualUpdate }
  | { ok: false; error: string };

/**
 * Validates recruiter-editable fields. Synced applicant fields are rejected for import contacts.
 */
export function buildManualContactUpdate(
  contact: CrmContact,
  input: CrmContactManualUpdate & {
    applicationStatus?: string | null;
    jobCategories?: string[];
  },
): BuildManualUpdateResult {
  const patch: CrmContactManualUpdate = {};
  const synced = contactHasSyncedApplicantData(contact);

  if (input.applicationStatus !== undefined || input.jobCategories !== undefined) {
    return { ok: false, error: "Application status and job categories are synced from applicants" };
  }
  if (synced && input.skills !== undefined) {
    return { ok: false, error: "Skills are synced from the candidate profile for imported contacts" };
  }
  if (synced && input.segmentKind !== undefined) {
    return { ok: false, error: "Segment kind is synced from application status for imported contacts" };
  }

  if (input.fullName !== undefined) patch.fullName = input.fullName?.trim() || null;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
  if (input.jobInterests !== undefined) {
    patch.jobInterests = input.jobInterests.map((s) => s.trim()).filter(Boolean);
  }
  if (input.segmentKind !== undefined) {
    if (!CRM_SEGMENT_KINDS.includes(input.segmentKind)) {
      return { ok: false, error: "Invalid segment kind" };
    }
    patch.segmentKind = input.segmentKind;
  }
  if (input.skills !== undefined) {
    patch.skills = input.skills.map((s) => s.trim()).filter(Boolean);
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No changes to save" };
  }
  return { ok: true, patch };
}

export function isApplicationStatusFilter(value: string): value is ApplicationStatus {
  return ["applied", "shortlisted", "interview", "hired", "rejected"].includes(value);
}

export function contactMatchesListFilters(contact: CrmContact, filter: CrmSegmentFilter): boolean {
  return contactMatchesFilter(contact, filter);
}
