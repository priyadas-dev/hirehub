import type { Database } from "@/integrations/supabase/types";

export type JobStatus = Database["public"]["Enums"]["job_status"];

/** Marker stored at the start of jobs.description (no deadline column in schema). */
const DEADLINE_PREFIX = /^\[\[hh:deadline:(\d{4}-\d{2}-\d{2})\]\]\n?/;

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

export function unpackJobDescription(raw: string | null | undefined): {
  description: string;
  applicationDeadline: string | null;
} {
  if (!raw) return { description: "", applicationDeadline: null };
  const match = raw.match(DEADLINE_PREFIX);
  if (!match?.[1]) return { description: raw, applicationDeadline: null };
  return {
    description: raw.slice(match[0].length),
    applicationDeadline: match[1],
  };
}

export function packJobDescription(description: string, applicationDeadline: string): string {
  const clean = unpackJobDescription(description).description.trim();
  return `[[hh:deadline:${applicationDeadline}]]\n${clean}`;
}

/** True when the calendar deadline day is today or later (local time). */
export function isDeadlineOnOrAfterToday(isoDate: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
  const [y, m, d] = isoDate.split("-").map(Number);
  const deadlineDay = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return deadlineDay.getTime() >= today.getTime();
}

/** Applications close after the end of the deadline day (local time). */
export function isApplicationDeadlinePassed(isoDate: string | null | undefined, now = new Date()): boolean {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
  const [y, m, d] = isoDate.split("-").map(Number);
  const end = new Date(y, m - 1, d, 23, 59, 59, 999);
  return now.getTime() > end.getTime();
}

export function fmtDeadline(isoDate: string | null | undefined): string | null {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
