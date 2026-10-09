import type { Database } from "@/integrations/supabase/types";

export type JobStatus = Database["public"]["Enums"]["job_status"];

/** Deadlines are calendar dates in this time zone (matches the database rule). */
export const DEADLINE_TIME_ZONE = "Asia/Dhaka";

/** Legacy marker that older listings stored at the start of jobs.description. */
const DEADLINE_PREFIX = /^\[\[hh:deadline:(\d{4}-\d{2}-\d{2})\]\]\n?/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

/** Strips a legacy deadline marker from a description (if any). */
export function unpackJobDescription(raw: string | null | undefined): {
  description: string;
  applicationDeadline: string | null;
} {
  if (!raw) return { description: "", applicationDeadline: null };
  const match = raw.match(DEADLINE_PREFIX);
  if (!match?.[1]) return { description: raw, applicationDeadline: null };
  return { description: raw.slice(match[0].length), applicationDeadline: match[1] };
}

/** Deadline for a job row: the database column, falling back to a legacy marker. */
export function jobDeadline(row: {
  application_deadline?: string | null;
  description?: string | null;
} | null | undefined): string | null {
  if (!row) return null;
  return row.application_deadline ?? unpackJobDescription(row.description).applicationDeadline;
}

/** Today's calendar date (YYYY-MM-DD) in Asia/Dhaka. */
export function dhakaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DEADLINE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** True when the deadline day is today or later (Asia/Dhaka). */
export function isDeadlineOnOrAfterToday(isoDate: string, now = new Date()): boolean {
  if (!ISO_DATE.test(isoDate)) return false;
  return isoDate >= dhakaToday(now);
}

/** Applications close after the end of the deadline day (Asia/Dhaka). */
export function isApplicationDeadlinePassed(isoDate: string | null | undefined, now = new Date()): boolean {
  if (!isoDate || !ISO_DATE.test(isoDate)) return false;
  return dhakaToday(now) > isoDate;
}

export function fmtDeadline(isoDate: string | null | undefined): string | null {
  if (!isoDate || !ISO_DATE.test(isoDate)) return null;
  const [y = 1970, m = 1, d = 1] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
