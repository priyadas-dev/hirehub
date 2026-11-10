import type { InterviewResponse } from "@/lib/integrations/google-calendar";
import {
  DEFAULT_INTERVIEW_TIMEZONE,
  GOOGLE_MEET_URL_PREFIX,
} from "@/lib/integrations/google-calendar";

const RESPONSE_LABELS: Record<InterviewResponse, string> = {
  needsAction: "Awaiting response",
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Tentative",
};

export function formatInterviewResponseLabel(value: string | null | undefined): string {
  if (!value) return RESPONSE_LABELS.needsAction;
  if (value in RESPONSE_LABELS) return RESPONSE_LABELS[value as InterviewResponse];
  return "Unknown";
}

export function isDisplayableMeetLink(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith(GOOGLE_MEET_URL_PREFIX);
}

function datetimeLocalParts(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Map an ISO timestamp to `datetime-local` value in the given IANA zone. */
export function isoToDatetimeLocalInZone(
  iso: string,
  timeZone: string = DEFAULT_INTERVIEW_TIMEZONE,
): string {
  return datetimeLocalParts(iso, timeZone);
}

/** Map `datetime-local` (interpreted in zone) to ISO offset string for the API. */
export function datetimeLocalInZoneToIso(
  local: string,
  timeZone: string = DEFAULT_INTERVIEW_TIMEZONE,
): string {
  const trimmed = local.trim();
  if (!trimmed) return "";
  // HireHub default zone has no DST; fixed +06:00 matches server validation.
  if (timeZone === "Asia/Dhaka") {
    return `${trimmed}:00+06:00`;
  }
  return `${trimmed}:00+06:00`;
}

export function formatInterviewRange(input: {
  startAt: string;
  endAt: string;
  timeZone?: string;
}): string {
  const tz = input.timeZone?.trim() || DEFAULT_INTERVIEW_TIMEZONE;
  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return "Invalid time";
  }
  const dateFmt = new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateFmt.format(start)} · ${timeFmt.format(start)} – ${timeFmt.format(end)} (${tz})`;
}

/** Suggested defaults: ~24h out, 45 minutes, in the default interview timezone. */
export function defaultInterviewDatetimeLocalInputs(
  nowMs: number = Date.now(),
  timeZone: string = DEFAULT_INTERVIEW_TIMEZONE,
): { startLocal: string; endLocal: string } {
  const leadMs = 24 * 60 * 60 * 1000;
  const startIso = new Date(nowMs + leadMs).toISOString();
  const startLocal = isoToDatetimeLocalInZone(startIso, timeZone);
  const startParsed = datetimeLocalInZoneToIso(startLocal, timeZone);
  const endIso = new Date(Date.parse(startParsed) + 45 * 60 * 1000).toISOString();
  return {
    startLocal,
    endLocal: isoToDatetimeLocalInZone(endIso, timeZone),
  };
}
