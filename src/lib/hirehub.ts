import type { Database } from "@/integrations/supabase/types";
import type { ApplicationStatus } from "@/components/status/status";

export type JobType = Database["public"]["Enums"]["job_type"];

export const JOB_TYPE_LABEL: Record<JobType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
};

/** Allowed recruiter status transitions. Rejected is allowed from any non-terminal stage. */
export function nextApplicationStatuses(current: ApplicationStatus): ApplicationStatus[] {
  switch (current) {
    case "applied":
      return ["shortlisted", "rejected"];
    case "shortlisted":
      return ["interview", "rejected"];
    case "interview":
      return ["hired", "rejected"];
    case "hired":
    case "rejected":
      return [];
    default:
      return [];
  }
}

export const STATUS_ACTION_LABEL: Partial<Record<ApplicationStatus, string>> = {
  shortlisted: "Shortlist",
  interview: "Move to interview",
  hired: "Hire",
  rejected: "Reject",
};
