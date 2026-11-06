import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function RecruiterAgentLoading({ label = "Working…" }: { label?: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-2xl border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
      data-testid="recruiter-agent-loading"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function RecruiterAgentEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      className="rounded-2xl border border-dashed bg-muted/20 px-4 py-6 text-center"
      data-testid="recruiter-agent-empty"
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      {action && (
        <Button type="button" size="sm" variant="outline" className="mt-3" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export function RecruiterAgentError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="space-y-2 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3"
      data-testid="recruiter-agent-error"
    >
      <p className="text-sm font-semibold text-destructive">Could not complete agent action</p>
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function RecruiterAgentSuccess({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-foreground",
        className,
      )}
      data-testid="recruiter-agent-success"
    >
      {message}
    </div>
  );
}
