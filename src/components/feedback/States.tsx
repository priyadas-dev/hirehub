import type { LucideIcon } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex animate-fade-up flex-col items-center justify-center rounded-2xl border border-dashed border-signal/30 bg-signal-soft/30 px-6 py-14 text-center sm:py-16",
        className,
      )}
    >
      <div className="relative mb-5">
        <div className="absolute inset-0 -m-4 rounded-2xl bg-signal-soft/80 blur-lg" aria-hidden />
        <div className="relative flex size-14 items-center justify-center rounded-2xl border bg-card text-signal shadow-card">
          <Icon className="size-5" />
        </div>
      </div>
      <h3 className="text-base font-semibold tracking-tight sm:text-lg">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this right now. Please try again.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex animate-fade-up flex-col items-center rounded-2xl border border-destructive/20 bg-destructive/5 px-6 py-12 text-center"
    >
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-destructive/10 bg-card text-destructive shadow-card">
        <AlertTriangle className="size-5" />
      </div>
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="surface-card animate-fade-in space-y-4 p-5 sm:p-6" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-xl" />
        <div className="flex-1 space-y-2.5">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string | undefined;
  title: string;
  description?: string | undefined;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex animate-fade-up flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-signal sm:text-xs">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-3xl sm:text-4xl">{title}</h1>
        {description && (
          <p className="mt-3 max-w-[68ch] text-base leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
