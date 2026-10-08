import { LayoutDashboard, Briefcase, FileText, Bookmark, Users, PlusSquare, ShieldCheck, Building2, UserCircle, BarChart3, ClipboardList, type LucideIcon } from "lucide-react";
import type { Role } from "@/lib/auth";

export type AppNavPath =
  | "/seeker"
  | "/seeker/jobs"
  | "/seeker/applications"
  | "/seeker/saved"
  | "/seeker/profile"
  | "/recruiter"
  | "/recruiter/jobs"
  | "/recruiter/jobs/new"
  | "/recruiter/applicants"
  | "/recruiter/company"
  | "/admin"
  | "/admin/jobs"
  | "/admin/users"
  | "/admin/companies"
  | "/admin/applications"
  | "/admin/reports";

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
    { label: "My Applications", icon: FileText, to: "/seeker/applications" },
    { label: "Saved Jobs", icon: Bookmark, soon: true },
    { label: "My Profile / Resume", icon: UserCircle, soon: true },
  ],
  recruiter: [
    { label: "Recruiter Dashboard", icon: LayoutDashboard, to: "/recruiter" },
    { label: "Post a Job", icon: PlusSquare, soon: true },
    { label: "My Job Posts", icon: Briefcase, soon: true },
    { label: "Applicants", icon: Users, to: "/recruiter/applicants" },
    { label: "Company Profile", icon: Building2, soon: true },
  ],
  admin: [
    { label: "Admin Dashboard", icon: LayoutDashboard, to: "/admin" },
    { label: "Approve Jobs", icon: ShieldCheck, soon: true },
    { label: "Manage Users", icon: Users, soon: true },
    { label: "Manage Companies", icon: Building2, soon: true },
    { label: "All Applications", icon: ClipboardList, soon: true },
    { label: "Reports", icon: BarChart3, soon: true },
  ],
};
