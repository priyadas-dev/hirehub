import { useState } from "react";
import { format, parse, startOfDay } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { businessCalendarDate, isRealCalendarDate } from "@/lib/job-fields";
import { cn } from "@/lib/utils";

/**
 * Parse YYYY-MM-DD as a civil calendar date for the DayPicker grid.
 * Uses date-fns parse (local components) so the stored DATE string is not shifted by UTC midnight.
 */
export function parseLocalDeadlineDate(iso: string): Date | undefined {
  if (!isRealCalendarDate(iso)) return undefined;
  return parse(iso, "yyyy-MM-dd", new Date());
}

/** Format a picked DayPicker date to YYYY-MM-DD civil date (no UTC conversion). */
export function formatLocalDeadlineDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

type DeadlineDatePickerProps = {
  id?: string;
  value: string;
  onChange: (isoDate: string) => void;
  disabled?: boolean;
  /** When true, days before today cannot be selected. */
  disablePast?: boolean;
  className?: string;
  placeholder?: string;
};

export function DeadlineDatePicker({
  id,
  value,
  onChange,
  disabled,
  disablePast = true,
  className,
  placeholder = "Pick a deadline",
}: DeadlineDatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseLocalDeadlineDate(value) : undefined;
  // "Today" for disabling past days follows HireHub business TZ (Asia/Dhaka), not browser-local.
  const businessToday = parseLocalDeadlineDate(businessCalendarDate()) ?? startOfDay(new Date());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-start text-left font-normal",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="mr-2 size-4 shrink-0 opacity-70" />
          {selected ? format(selected, "MMM d, yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? businessToday}
          disabled={disablePast ? { before: businessToday } : undefined}
          onSelect={(date) => {
            if (!date) return;
            onChange(formatLocalDeadlineDate(date));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
