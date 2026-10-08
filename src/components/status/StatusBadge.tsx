import { cn } from "@/lib/utils";
import { STATUS_META, type ApplicationStatus } from "./status";

export function StatusBadge({ status, className }: { status: ApplicationStatus; className?: string }) {
  const m = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ring-black/5 transition-colors",
        m.soft,
        m.text,
        className,
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", m.bg)} aria-hidden />
      {m.label}
    </span>
  );
}
