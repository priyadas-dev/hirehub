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
    signal: "bg-signal-soft text-signal",
    shortlisted: "bg-status-shortlisted-soft text-status-shortlisted",
    interview: "bg-status-interview-soft text-status-interview",
    hired: "bg-status-hired-soft text-status-hired",
    applied: "bg-status-applied-soft text-status-applied",
  }[tone];
  return (
    <div className="surface-card interactive-card p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={cn("flex size-8 items-center justify-center rounded-lg", toneCls)}><Icon className="size-4" /></span>
      </div>
      {loading ? <Skeleton className="mt-3 h-10 w-16" /> : <p className="mt-3 font-display text-4xl tabular-nums">{value ?? 0}</p>}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Section({ title, description, action, children, className }: {
  title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
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
