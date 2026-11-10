import type { CrmContact } from "@/lib/crm/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the route param is a UUID (invalid ids should render not-found, not a fetch error). */
export function isCrmSegmentId(segmentId: string): boolean {
  return UUID_RE.test(segmentId.trim());
}

export function dedupeContactIds(contactIds: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of contactIds) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** Default name when recruiter leaves segment name empty. */
export function defaultManualSegmentName(contacts: CrmContact[]): string {
  const date = new Date().toISOString().slice(0, 10);
  if (contacts.length === 0) return `Manual segment · ${date}`;
  if (contacts.length === 1) {
    const c = contacts[0];
    const label = c.fullName?.trim() || c.email.split("@")[0] || "Contact";
    return `${label} · ${date}`;
  }
  const categories = [...new Set(contacts.flatMap((c) => c.jobCategories).filter(Boolean))];
  if (categories.length === 1) {
    return `${categories[0]} · ${contacts.length} contacts · ${date}`;
  }
  return `Manual segment · ${contacts.length} contacts · ${date}`;
}

export function segmentTypeLabel(segmentType: "manual" | "filter"): string {
  return segmentType === "manual" ? "Manual" : "Filter";
}
