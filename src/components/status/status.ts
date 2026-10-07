import { CheckCircle2, FileText, Star, CalendarClock, XCircle, type LucideIcon } from "lucide-react";

export type ApplicationStatus = "applied" | "shortlisted" | "interview" | "hired" | "rejected";

export const JOURNEY: Exclude<ApplicationStatus, "rejected">[] = ["applied", "shortlisted", "interview", "hired"];

export const STATUS_META: Record<
  ApplicationStatus,
  { label: string; icon: LucideIcon; text: string; bg: string; soft: string; border: string }
> = {
  applied: { label: "Applied", icon: FileText, text: "text-status-applied", bg: "bg-status-applied", soft: "bg-status-applied-soft", border: "border-status-applied" },
  shortlisted: { label: "Shortlisted", icon: Star, text: "text-status-shortlisted", bg: "bg-status-shortlisted", soft: "bg-status-shortlisted-soft", border: "border-status-shortlisted" },
  interview: { label: "Interview", icon: CalendarClock, text: "text-status-interview", bg: "bg-status-interview", soft: "bg-status-interview-soft", border: "border-status-interview" },
  hired: { label: "Hired", icon: CheckCircle2, text: "text-status-hired", bg: "bg-status-hired", soft: "bg-status-hired-soft", border: "border-status-hired" },
  rejected: { label: "Not selected", icon: XCircle, text: "text-status-rejected", bg: "bg-status-rejected", soft: "bg-status-rejected-soft", border: "border-status-rejected" },
};
