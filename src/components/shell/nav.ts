import { LayoutDashboard, Briefcase, FileText, Bookmark, Users, PlusSquare, ShieldCheck, Building2, UserCircle, BarChart3, ClipboardList, Settings, FileDiff, MessageSquareText, Bot, type LucideIcon } from "lucide-react";
import type { Role } from "@/lib/auth";

export type AppNavPath =
  | "/seeker"
  | "/seeker/jobs"
  | "/seeker/applications"
  | "/seeker/saved"
  | "/seeker/profile"
  | "/seeker/assistant"
  | "/recruiter"
  | "/recruiter/jobs"
  | "/recruiter/jobs/new"
  | "/recruiter/applicants"
  | "/recruiter/agent"
  | "/recruiter/company"
  | "/admin"
  | "/admin/jobs"
  | "/admin/users"
  | "/admin/companies"
  | "/admin/applications"
  | "/admin/reports"
  | "/admin/job-revisions"
  | "/admin/profile"
  | "/settings";

export interface NavItem {
  label: string;
  icon: LucideIcon;
  to?: AppNavPath;
  soon?: boolean;
}

/** Role-aware navigation. */
export const NAV: Record<Role, NavItem[]> = {
  seeker: [
    { label: "Dashboard", icon: LayoutDashboard, to: "/seeker" },
    { label: "Browse Jobs", icon: Briefcase, to: "/seeker/jobs" },
    { label: "AI Job Assistant", icon: MessageSquareText, to: "/seeker/assistant" },
    { label: "My Applications", icon: FileText, to: "/seeker/applications" },
    { label: "Saved Jobs", icon: Bookmark, to: "/seeker/saved" },
    { label: "My Profile / Resume", icon: UserCircle, to: "/seeker/profile" },
    { label: "Settings", icon: Settings, to: "/settings" },
  ],
  recruiter: [
    { label: "Recruiter Dashboard", icon: LayoutDashboard, to: "/recruiter" },
    { label: "Post a Job", icon: PlusSquare, to: "/recruiter/jobs/new" },
    { label: "My Job Posts", icon: Briefcase, to: "/recruiter/jobs" },
    { label: "Applicants", icon: Users, to: "/recruiter/applicants" },
    { label: "AI Recruiter Agent", icon: Bot, to: "/recruiter/agent" },
    { label: "Company Profile", icon: Building2, to: "/recruiter/company" },
    { label: "Settings", icon: Settings, to: "/settings" },
  ],
  admin: [
    { label: "Admin Dashboard", icon: LayoutDashboard, to: "/admin" },
    { label: "Approve Jobs", icon: ShieldCheck, to: "/admin/jobs" },
    { label: "Job revisions", icon: FileDiff, to: "/admin/job-revisions" },
    { label: "Manage Users", icon: Users, to: "/admin/users" },
    { label: "Manage Companies", icon: Building2, to: "/admin/companies" },
    { label: "All Applications", icon: ClipboardList, to: "/admin/applications" },
    { label: "Reports", icon: BarChart3, to: "/admin/reports" },
    { label: "My Profile", icon: UserCircle, to: "/admin/profile" },
    { label: "Settings", icon: Settings, to: "/settings" },
  ],
};
