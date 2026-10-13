import type { ComponentType } from "react";
import { CalendarDays, Clock, MapPin, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export function fmtPostedDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type MetaItemProps = {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  value: string;
  className?: string;
};

function MetaItem({ icon: Icon, label, value, className }: MetaItemProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-xs text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
      <span className="sr-only">{label}: </span>
      <span className="min-w-0 truncate">{value}</span>
    </span>
  );
}

export type RecruiterJobMetaProps = {
  location: string | null | undefined;
  createdAt: string;
  applicantCount?: number;
  deadlineLabel?: string | null;
  deadlineExpired?: boolean;
  companyName?: string | null;
  jobTypeLabel?: string | null;
  className?: string;
};

/** Compact, labeled metadata chips — avoids jammed separator strings. */
export function RecruiterJobMeta({
  location,
  createdAt,
  applicantCount,
  deadlineLabel,
  deadlineExpired,
  companyName,
  jobTypeLabel,
  className,
}: RecruiterJobMetaProps) {
  const place = location?.trim() || "Remote";
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {companyName ? (
        <span className="inline-flex max-w-full items-center rounded-md border border-border/70 bg-card px-2 py-1 text-xs font-medium text-foreground">
          <span className="truncate">{companyName}</span>
        </span>
      ) : null}
      <MetaItem icon={MapPin} label="Location" value={place} />
      {jobTypeLabel ? (
        <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
          {jobTypeLabel}
        </span>
      ) : null}
      <MetaItem icon={CalendarDays} label="Posted" value={fmtPostedDate(createdAt)} />
      {typeof applicantCount === "number" ? (
        <MetaItem
          icon={Users}
          label="Applicants"
          value={`${applicantCount} applicant${applicantCount === 1 ? "" : "s"}`}
        />
      ) : null}
      {deadlineLabel ? (
        <MetaItem
          icon={Clock}
          label="Deadline"
          value={deadlineExpired ? `Deadline ${deadlineLabel} (expired)` : `Deadline ${deadlineLabel}`}
          className={deadlineExpired ? "border-status-interview/40 bg-status-interview-soft/50 text-status-interview" : undefined}
        />
      ) : null}
    </div>
  );
}
