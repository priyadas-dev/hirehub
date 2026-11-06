import { contactMatchesFilter, filterContactsForRecruiter } from "@/lib/crm/contacts";
import type {
  CrmContact,
  CrmSegment,
  CrmSegmentFilter,
  CrmSegmentKind,
  CrmSegmentType,
} from "@/lib/crm/types";
import { CRM_SEGMENT_KINDS, CRM_SEGMENT_TYPES } from "@/lib/crm/types";

export function parseSegmentFilter(raw: unknown): CrmSegmentFilter {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const skills = Array.isArray(o.skills) ? o.skills.filter((s): s is string => typeof s === "string") : undefined;
  const jobInterests = Array.isArray(o.jobInterests)
    ? o.jobInterests.filter((s): s is string => typeof s === "string")
    : undefined;
  const jobCategories = Array.isArray(o.jobCategories)
    ? o.jobCategories.filter((s): s is string => typeof s === "string")
    : undefined;
  const applicationStatuses = Array.isArray(o.applicationStatuses)
    ? o.applicationStatuses.filter((s): s is string => typeof s === "string")
    : undefined;
  const segmentKinds = Array.isArray(o.segmentKinds)
    ? o.segmentKinds.filter((s): s is CrmSegmentKind =>
        typeof s === "string" && (CRM_SEGMENT_KINDS as readonly string[]).includes(s),
      )
    : undefined;
  const query = typeof o.query === "string" ? o.query : undefined;
  return { skills, jobInterests, jobCategories, applicationStatuses, segmentKinds, query };
}

export function parseSegmentType(raw: unknown): CrmSegmentType {
  if (typeof raw === "string" && (CRM_SEGMENT_TYPES as readonly string[]).includes(raw)) {
    return raw as CrmSegmentType;
  }
  return "filter";
}

export function createSegmentRecord(input: {
  id?: string;
  recruiterId: string;
  name: string;
  kind?: CrmSegmentKind;
  segmentType?: CrmSegmentType;
  filter?: CrmSegmentFilter;
  createdAt?: string;
}): CrmSegment | { error: string } {
  if (!input.recruiterId) return { error: "recruiterId is required" };
  const name = input.name.trim();
  if (!name) return { error: "Segment name is required" };
  const kind = input.kind ?? "new";
  if (!CRM_SEGMENT_KINDS.includes(kind)) return { error: "Invalid segment kind" };
  const segmentType = input.segmentType ?? "filter";
  if (!CRM_SEGMENT_TYPES.includes(segmentType)) return { error: "Invalid segment type" };
  return {
    id: input.id ?? crypto.randomUUID(),
    recruiterId: input.recruiterId,
    name,
    kind,
    segmentType,
    filter: input.filter ?? (segmentType === "manual" ? {} : { segmentKinds: [kind] }),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export type ResolveSegmentAudienceOptions = {
  /** Contact ids for manual segments (from crm_segment_members). */
  manualMemberContactIds?: string[];
};

/** Resolve audience: manual membership or owner-scoped filter match. */
export function resolveSegmentAudience(
  contacts: CrmContact[],
  segment: CrmSegment,
  options: ResolveSegmentAudienceOptions = {},
): CrmContact[] {
  const owned = filterContactsForRecruiter(contacts, segment.recruiterId, {});

  if (segment.segmentType === "manual") {
    const memberIds = new Set(options.manualMemberContactIds ?? []);
    if (memberIds.size === 0) return [];
    return owned.filter((c) => memberIds.has(c.id));
  }

  const filter: CrmSegmentFilter = {
    ...segment.filter,
    segmentKinds: segment.filter.segmentKinds?.length
      ? segment.filter.segmentKinds
      : [segment.kind],
  };
  return owned.filter((c) => contactMatchesFilter(c, filter));
}
