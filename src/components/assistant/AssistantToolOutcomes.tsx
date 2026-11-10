import { Link } from "@tanstack/react-router";
import { Bookmark, BookmarkCheck, Briefcase, MapPin } from "lucide-react";
import { StatusBadge } from "@/components/status/StatusBadge";
import type { ApplicationStatus } from "@/components/status/status";
import { Button } from "@/components/ui/button";
import type {
  ApplicationStatusItemPayload,
  SaveJobOutcomePayload,
} from "@/lib/ai/job-assistant";
import { cn } from "@/lib/utils";

const KNOWN_STATUSES = new Set<ApplicationStatus>([
  "applied",
  "shortlisted",
  "interview",
  "hired",
  "rejected",
]);

function asApplicationStatus(value: string): ApplicationStatus {
  return KNOWN_STATUSES.has(value as ApplicationStatus) ? (value as ApplicationStatus) : "applied";
}

function formatAppliedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function SaveJobOutcomeChip({ outcome }: { outcome: SaveJobOutcomePayload }) {
  const already = outcome.status === "already_saved";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-3",
        already ? "border-border bg-muted/40" : "border-emerald-500/30 bg-emerald-500/5",
      )}
      data-testid="save-job-outcome"
      data-status={outcome.status}
    >
      {already ? (
        <Bookmark className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <BookmarkCheck className="size-4 shrink-0 text-emerald-700" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {already ? "Already saved" : "Saved to bookmarks"}
        </p>
        <p className="truncate text-xs text-muted-foreground">{outcome.title}</p>
      </div>
      <Button variant="outline" size="sm" asChild>
        <Link to="/seeker/saved">View saved</Link>
      </Button>
    </div>
  );
}

export function ApplicationStatusOutcomeList({
  applications,
}: {
  applications: ApplicationStatusItemPayload[];
}) {
  if (applications.length === 0) {
    return (
      <div
        className="rounded-2xl border border-dashed bg-muted/20 px-4 py-5 text-center"
        data-testid="application-status-empty"
      >
        <Briefcase className="mx-auto size-5 text-muted-foreground" aria-hidden />
        <p className="mt-2 text-sm font-medium text-foreground">No applications found</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Apply to an approved job, then ask again to track status.
        </p>
        <Button variant="outline" size="sm" className="mt-3" asChild>
          <Link to="/seeker/jobs">Browse jobs</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="application-status-list">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Your applications ({applications.length})
      </p>
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {applications.map((app) => (
          <li
            key={app.id}
            className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            data-testid="application-status-item"
          >
            <div className="min-w-0 space-y-1">
              <p className="truncate text-sm font-medium text-foreground">{app.jobTitle}</p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                {app.companyName && <span>{app.companyName}</span>}
                {app.location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" aria-hidden />
                    {app.location}
                  </span>
                )}
                <span>Applied {formatAppliedDate(app.createdAt)}</span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusBadge status={asApplicationStatus(app.status)} />
              <Button variant="outline" size="sm" asChild>
                <Link to="/seeker/applications/$applicationId" params={{ applicationId: app.id }}>
                  Track
                </Link>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
