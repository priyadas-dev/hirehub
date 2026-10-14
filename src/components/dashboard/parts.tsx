import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Runs a head-only count query; RLS decides what the user may count. */
export async function countRows(build: () => PromiseLike<{ count: number | null; error: unknown }>) {
  const { count, error } = await build();
  if (error) throw error;
  return count ?? 0;
}

export function useCounts<T extends Record<string, number>>(key: string, userId: string | undefined, fn: () => Promise<T>) {
  return useQuery({ queryKey: ["dash-counts", key, userId], queryFn: fn, enabled: !!userId });
}

export { supabase };

/** Focusable wrapper for dashboard metric cards. */
export const STAT_LINK =
  "block rounded-xl outline-none transition-transform duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.99]";

/** Row link inside surface-card lists. */
export const LIST_LINK =
  "group outline-none transition-colors duration-200 ease-out hover:bg-signal-soft/45 focus-visible:bg-signal-soft/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

export function StatCard({ label, value, icon: Icon, hint, loading, tone = "signal" }: {
  label: string; value: number | undefined; icon: LucideIcon; hint?: string; loading?: boolean;
  tone?: "signal" | "shortlisted" | "interview" | "hired" | "applied" | "quiet";
}) {
  const toneCls = {
    signal: "bg-signal-soft text-signal ring-signal/20",
    shortlisted: "bg-status-shortlisted-soft text-status-shortlisted ring-status-shortlisted/20",
    interview: "bg-status-interview-soft text-status-interview ring-status-interview/20",
    hired: "bg-status-hired-soft text-status-hired ring-status-hired/20",
    applied: "bg-status-applied-soft text-status-applied ring-status-applied/20",
    quiet: "bg-muted text-muted-foreground ring-border/60",
  }[tone];
  const wash = {
    signal: "from-signal-soft/45",
    shortlisted: "from-status-shortlisted-soft/40",
    interview: "from-status-interview-soft/35",
    hired: "from-status-hired-soft/40",
    applied: "from-status-applied-soft/40",
    quiet: "from-muted/55",
  }[tone];
  return (
    <div className="surface-card interactive-card group relative h-full overflow-hidden p-5 sm:p-6">
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br via-transparent to-transparent", wash)} aria-hidden />
      <div className="relative flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 transition-transform duration-300 group-hover:scale-105", toneCls)}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      {loading ? (
        <Skeleton className="relative mt-4 h-10 w-16" />
      ) : (
        <p className="type-data relative mt-5 text-4xl text-foreground">{value ?? 0}</p>
      )}
      {hint && <p className="relative mt-2 text-sm leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Section({ title, description, action, children, className }: {
  title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-4 sm:gap-5", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
          {description && <p className="mt-1 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
