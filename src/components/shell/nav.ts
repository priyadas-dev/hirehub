import { LayoutDashboard, Briefcase, FileText, Bookmark, Users, PlusSquare, ShieldCheck, Building2, UserCircle, BarChart3, ClipboardList, type LucideIcon } from "lucide-react";
import type { Role } from "@/lib/auth";

export interface NavItem {
  label: string;
  icon: LucideIcon;
  to?: "/seeker" | "/recruiter" | "/admin";
  soon?: boolean;
}

/** Role-aware navigation. Items marked `soon` get real routes in later milestones. */
export const NAV: Record<Role, NavItem[]> = {
  seeker: [
    { label: "Dashboard", icon: LayoutDashboard, to: "/seeker" },
    { label: "Browse Jobs", icon: Briefcase, soon: true },
    { label: "My Applications", icon: FileText, soon: true },
    { label: "Saved Jobs", icon: Bookmark, soon: true },
    { label: "My Profile / Resume", icon: UserCircle, soon: true },
  ],
  recruiter: [
    { label: "Recruiter Dashboard", icon: LayoutDashboard, to: "/recruiter" },
    { label: "Post a Job", icon: PlusSquare, soon: true },
    { label: "My Job Posts", icon: Briefcase, soon: true },
    { label: "Applicants", icon: Users, soon: true },
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
