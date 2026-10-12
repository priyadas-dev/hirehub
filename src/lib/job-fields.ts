import type { Database } from "@/integrations/supabase/types";

export type JobStatus = Database["public"]["Enums"]["job_status"];

/**
 * HireHub business timezone for application deadlines.
 * DATE values are calendar days in this zone for both UI and RLS (migration 0003):
 *   apply allowed while application_deadline >= (timezone('Asia/Dhaka', now()))::date
 *   or application_deadline IS NULL.
 * Decision: Asia/Dhaka (UTC+6) — explicit product timezone; not browser-local, not UTC.
 */
export const HIREHUB_DEADLINE_TIMEZONE = "Asia/Dhaka" as const;

/** Alias kept for remote-compatible imports. */
export const DEADLINE_TIME_ZONE = HIREHUB_DEADLINE_TIMEZONE;

/** Legacy marker previously stored at the start of jobs.description. */
export const DEADLINE_MARKER_RE = /^\[\[hh:deadline:(\d{4}-\d{2}-\d{2})\]\]\r?\n?/;

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  closed: "Closed",
};

export const JOB_STATUS_BADGE_CLASS: Record<JobStatus, string> = {
  pending: "border-status-interview/40 bg-status-interview-soft/60 text-status-interview",
  approved: "border-status-hired/40 bg-status-hired-soft/60 text-status-hired",
  closed: "border-border bg-muted/60 text-muted-foreground",
};

/** YYYY-MM-DD for `now` in the HireHub business timezone (mirrors SQL timezone(...)). */
export function businessCalendarDate(
  now = new Date(),
  timeZone: string = HIREHUB_DEADLINE_TIMEZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) {
    throw new Error(`Could not format business calendar date for ${timeZone}`);
  }
  return `${y}-${m}-${d}`;
}

/** True for a real Gregorian calendar day (rejects 2026-02-30, 2026-13-01). */
export function isRealCalendarDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parts = value.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function isValidDeadlineDate(value: string | null | undefined): value is string {
  return isRealCalendarDate(value);
}

/** Parse legacy description marker. Malformed / non-calendar prefixes yield null deadline. */
export function unpackJobDescription(raw: string | null | undefined): {
  description: string;
  applicationDeadline: string | null;
} {
  if (!raw) return { description: "", applicationDeadline: null };
  const match = raw.match(DEADLINE_MARKER_RE);
  if (!match?.[1] || !isRealCalendarDate(match[1])) {
    return { description: raw, applicationDeadline: null };
  }
  return {
    description: raw.slice(match[0].length),
    applicationDeadline: match[1],
  };
}

/** Strip a recognized valid calendar marker only; leave malformed / unmarked text alone. */
export function stripDeadlineMarker(raw: string | null | undefined): string {
  return unpackJobDescription(raw).description;
}

/**
 * Prefer the DB column; fall back to a legacy description marker when the column is null.
 * Returns ISO date YYYY-MM-DD or null.
 */
export function resolveJobDeadline(
  columnDeadline: string | null | undefined,
  description: string | null | undefined,
): string | null {
  // Copy before the type-predicate: a failed `value is string` guard would narrow the binding to `never`.
  if (typeof columnDeadline === "string") {
    const raw = `${columnDeadline}`;
    if (isRealCalendarDate(columnDeadline)) return columnDeadline;
    const dateOnly = raw.slice(0, 10);
    if (isRealCalendarDate(dateOnly)) return dateOnly;
  }
  return unpackJobDescription(description).applicationDeadline;
}

/**
 * Pure helper mirroring migration 0002 backfill rules:
 * - never overwrite non-null deadline
 * - only strip/backfill recognized real calendar markers
 * - leave malformed markers untouched
 */
export function migrateLegacyDeadlineRow(row: {
  application_deadline: string | null;
  description: string | null;
}): { application_deadline: string | null; description: string | null } {
  const parsed = unpackJobDescription(row.description);
  const hasExisting = row.application_deadline != null && row.application_deadline !== "";

  if (!parsed.applicationDeadline) {
    return {
      application_deadline: row.application_deadline,
      description: row.description,
    };
  }

  return {
    application_deadline: hasExisting ? row.application_deadline : parsed.applicationDeadline,
    description: parsed.description === "" ? null : parsed.description,
  };
}

/** @deprecated Prefer column writes; kept for tests covering legacy packing. */
export function packJobDescription(description: string, applicationDeadline: string): string {
  const clean = stripDeadlineMarker(description).trim();
  return `[[hh:deadline:${applicationDeadline}]]\n${clean}`;
}

/** True when deadline day is today or later in Asia/Dhaka (matches RLS). */
export function isDeadlineOnOrAfterToday(isoDate: string, now = new Date()): boolean {
  if (!isRealCalendarDate(isoDate)) return false;
  return isoDate >= businessCalendarDate(now);
}

/**
 * Applications close after the Asia/Dhaka calendar day of the deadline ends.
 * Equivalent to: businessCalendarDate(now) > deadline. Null = not expired.
 */
export function isApplicationDeadlinePassed(isoDate: string | null | undefined, now = new Date()): boolean {
  if (!isRealCalendarDate(isoDate)) return false;
  return businessCalendarDate(now) > isoDate;
}

/** Whether a recruiter may set `next` as the new deadline given the current stored value. */
export function canSetApplicationDeadline(
  next: string,
  previous: string | null | undefined,
  now = new Date(),
): boolean {
  if (!isRealCalendarDate(next)) return false;
  if (isDeadlineOnOrAfterToday(next, now)) return true;
  return previous != null && next === previous;
}

export function fmtDeadline(isoDate: string | null | undefined): string | null {
  if (!isRealCalendarDate(isoDate)) return null;
  const parts = isoDate.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined) return null;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Alias for remote-compatible callsites (`dhakaToday`). */
export const dhakaToday = businessCalendarDate;

/** Deadline for a job row: DB column, falling back to a legacy description marker. */
export function jobDeadline(
  row:
    | {
        application_deadline?: string | null;
        description?: string | null;
      }
    | null
    | undefined,
): string | null {
  if (!row) return null;
  return resolveJobDeadline(row.application_deadline, row.description);
}
