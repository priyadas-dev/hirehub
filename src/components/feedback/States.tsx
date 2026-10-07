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
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed bg-surface/60 px-6 py-14 text-center", className)}>
      <div className="relative mb-5">
        <div className="absolute inset-0 -m-3 rounded-2xl bg-signal-soft blur-md" aria-hidden />
        <div className="relative flex size-12 items-center justify-center rounded-xl border bg-card text-signal shadow-card">
          <Icon className="size-5" />
        </div>
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
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
    <div role="alert" className="flex flex-col items-center rounded-xl border border-destructive/20 bg-destructive/5 px-6 py-12 text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-card text-destructive shadow-card">
        <AlertTriangle className="size-5" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
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
    <div className="surface-card space-y-3 p-5" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-lg" />
        <div className="flex-1 space-y-2">
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

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string | undefined; title: string; description?: string | undefined; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-signal">{eyebrow}</p>}
        <h1 className="font-display text-4xl leading-tight sm:text-5xl">{title}</h1>
        {description && <p className="mt-2 max-w-xl text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
