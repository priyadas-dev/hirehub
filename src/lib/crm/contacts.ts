import type { CrmContact, CrmSegmentFilter, CrmSegmentKind } from "@/lib/crm/types";
import { CRM_SEGMENT_KINDS } from "@/lib/crm/types";

export function normalizeContactEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidContactEmail(email: string): boolean {
  const e = normalizeContactEmail(email);
  return e.includes("@") && e.includes(".") && e.length <= 255;
}

export type CreateContactInput = {
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
  id?: string;
  createdAt?: string;
};

export type CreateContactResult =
  | { ok: true; contact: CrmContact; created: true }
  | { ok: true; contact: CrmContact; created: false; reason: "duplicate_email" }
  | { ok: false; error: string };

export function buildContactRecord(input: CreateContactInput): CrmContact | { error: string } {
  if (!input.recruiterId) return { error: "recruiterId is required" };
  if (!isValidContactEmail(input.email)) return { error: "A valid email is required" };
  const kind = input.segmentKind ?? "new";
  if (!CRM_SEGMENT_KINDS.includes(kind)) return { error: "Invalid segment kind" };
  const now = input.createdAt ?? new Date().toISOString();
  return {
    id: input.id ?? crypto.randomUUID(),
    recruiterId: input.recruiterId,
    companyId: input.companyId ?? null,
    seekerProfileId: input.seekerProfileId ?? null,
    email: input.email.trim(),
    emailNormalized: normalizeContactEmail(input.email),
    fullName: input.fullName?.trim() || null,
    skills: (input.skills ?? []).map((s) => s.trim()).filter(Boolean),
    jobInterests: (input.jobInterests ?? []).map((s) => s.trim()).filter(Boolean),
    jobCategories: (input.jobCategories ?? []).map((s) => s.trim()).filter(Boolean),
    applicationStatus: input.applicationStatus ?? null,
    segmentKind: kind,
    hubspotContactId: input.hubspotContactId ?? null,
    notes: input.notes ?? null,
    createdAt: now,
  };
}

/**
 * Insert contact or return existing when (recruiterId, emailNormalized) collides.
 */
export function upsertContactAvoidingDuplicate(
  existing: CrmContact[],
  input: CreateContactInput,
): CreateContactResult {
  const built = buildContactRecord(input);
  if ("error" in built) return { ok: false, error: built.error };

  const dup = existing.find(
    (c) => c.recruiterId === built.recruiterId && c.emailNormalized === built.emailNormalized,
  );
  if (dup) {
    return { ok: true, contact: dup, created: false, reason: "duplicate_email" };
  }
  return { ok: true, contact: built, created: true };
}

function includesAny(haystack: string[], needles: string[]): boolean {
  if (needles.length === 0) return true;
  const set = new Set(haystack.map((s) => s.toLowerCase()));
  return needles.some((n) => set.has(n.toLowerCase()));
}

export function contactMatchesFilter(contact: CrmContact, filter: CrmSegmentFilter): boolean {
  if (filter.segmentKinds?.length && !filter.segmentKinds.includes(contact.segmentKind)) {
    return false;
  }
  if (filter.applicationStatuses?.length) {
    if (!contact.applicationStatus || !filter.applicationStatuses.includes(contact.applicationStatus)) {
      return false;
    }
  }
  if (filter.skills?.length && !includesAny(contact.skills, filter.skills)) {
    return false;
  }
  if (filter.jobInterests?.length && !includesAny(contact.jobInterests, filter.jobInterests)) {
    return false;
  }
  if (filter.jobCategories?.length && !includesAny(contact.jobCategories, filter.jobCategories)) {
    return false;
  }
  if (filter.query?.trim()) {
    const q = filter.query.trim().toLowerCase();
    const blob = `${contact.fullName ?? ""} ${contact.email} ${contact.skills.join(" ")} ${contact.jobInterests.join(" ")}`.toLowerCase();
    if (!blob.includes(q)) return false;
  }
  return true;
}

export function filterContactsForRecruiter(
  contacts: CrmContact[],
  recruiterId: string,
  filter: CrmSegmentFilter = {},
): CrmContact[] {
  return contacts
    .filter((c) => c.recruiterId === recruiterId)
    .filter((c) => contactMatchesFilter(c, filter));
}
