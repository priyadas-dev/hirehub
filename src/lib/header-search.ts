import type { Role } from "@/lib/auth";

export type HeaderSearchTarget =
  | { to: "/seeker/jobs"; search: { q?: string } }
  | { to: "/recruiter/jobs"; search: { q?: string } }
  | { to: "/admin/jobs"; search: { q?: string } };

/** Role-aware destination for the shell header search box. */
export function headerSearchTarget(role: Role, rawQuery: string): HeaderSearchTarget {
  const q = rawQuery.trim() || undefined;
  if (role === "recruiter") return { to: "/recruiter/jobs", search: { q } };
  if (role === "admin") return { to: "/admin/jobs", search: { q } };
  return { to: "/seeker/jobs", search: { q } };
}

export function headerSearchPlaceholder(role: Role): string {
  if (role === "recruiter") return "Search your job posts…";
  if (role === "admin") return "Search jobs by title or company…";
  return "Search jobs by title, company, or location…";
}
