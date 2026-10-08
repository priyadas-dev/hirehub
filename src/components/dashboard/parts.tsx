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

export function StatCard({ label, value, icon: Icon, hint, loading, tone = "signal" }: {
  label: string; value: number | undefined; icon: LucideIcon; hint?: string; loading?: boolean;
  tone?: "signal" | "shortlisted" | "interview" | "hired" | "applied";
}) {
  const toneCls = {
    signal: "bg-signal-soft text-signal ring-signal/10",
    shortlisted: "bg-status-shortlisted-soft text-status-shortlisted ring-status-shortlisted/10",
    interview: "bg-status-interview-soft text-status-interview ring-status-interview/10",
    hired: "bg-status-hired-soft text-status-hired ring-status-hired/10",
    applied: "bg-status-applied-soft text-status-applied ring-status-applied/10",
  }[tone];
  const glowCls = {
    signal: "bg-signal/20",
    shortlisted: "bg-status-shortlisted/25",
    interview: "bg-status-interview/20",
    hired: "bg-status-hired/25",
    applied: "bg-status-applied/20",
  }[tone];
  return (
    <div className="surface-card interactive-card group relative overflow-hidden p-5 sm:p-6">
      <div className={cn("pointer-events-none absolute -right-6 -top-6 size-24 rounded-full opacity-50 blur-2xl transition-opacity group-hover:opacity-80", glowCls)} aria-hidden />
      <div className="relative flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span className={cn("flex size-9 items-center justify-center rounded-xl ring-1 transition-transform duration-300 group-hover:scale-105", toneCls)}>
          <Icon className="size-4" />
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-4 h-10 w-16" />
      ) : (
        <p className="mt-4 font-display text-4xl tabular-nums tracking-tight sm:text-[2.75rem]">{value ?? 0}</p>
      )}
      {hint && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Section({ title, description, action, children, className }: {
  title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
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
