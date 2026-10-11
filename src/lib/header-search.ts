import type { Role } from "@/lib/auth";

export type HeaderSearchTarget =
  | { to: "/seeker/jobs"; search: { q?: string } }
  | { to: "/recruiter/jobs"; search: { q?: string } }
  | { to: "/admin/jobs"; search: { q?: string } };

/** Role-aware destination for the shell header search box. */
export function headerSearchTarget(role: Role, rawQuery: string): HeaderSearchTarget {
  const trimmed = rawQuery.trim();
  // exactOptionalPropertyTypes: omit `q` when empty instead of `{ q: undefined }`.
  const search = trimmed ? { q: trimmed } : {};
  if (role === "recruiter") return { to: "/recruiter/jobs", search };
  if (role === "admin") return { to: "/admin/jobs", search };
  return { to: "/seeker/jobs", search };
}

export function headerSearchPlaceholder(role: Role): string {
  if (role === "recruiter") return "Search your job posts…";
  if (role === "admin") return "Search jobs by title or company…";
  return "Search jobs by title, company, or location…";
}
