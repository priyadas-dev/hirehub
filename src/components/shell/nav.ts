import { LayoutDashboard, Briefcase, FileText, Bookmark, Users, PlusSquare, ShieldCheck, Building2, type LucideIcon } from "lucide-react";
import type { Role } from "@/lib/auth";

export interface NavItem {
  label: string;
  icon: LucideIcon;
  to?: "/dashboard";
  soon?: boolean;
}

/** Role-aware navigation. Items marked `soon` get real routes in later iterations. */
export const NAV: Record<Role, NavItem[]> = {
  seeker: [
    { label: "Overview", icon: LayoutDashboard, to: "/dashboard" },
    { label: "Browse jobs", icon: Briefcase, soon: true },
    { label: "My applications", icon: FileText, soon: true },
    { label: "Saved", icon: Bookmark, soon: true },
  ],
  recruiter: [
    { label: "Overview", icon: LayoutDashboard, to: "/dashboard" },
    { label: "Post a job", icon: PlusSquare, soon: true },
    { label: "My listings", icon: Briefcase, soon: true },
    { label: "Candidates", icon: Users, soon: true },
  ],
  admin: [
    { label: "Overview", icon: LayoutDashboard, to: "/dashboard" },
    { label: "Users", icon: Users, soon: true },
    { label: "Companies", icon: Building2, soon: true },
    { label: "Moderation", icon: ShieldCheck, soon: true },
  ],
};
