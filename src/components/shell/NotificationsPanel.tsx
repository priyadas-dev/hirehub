import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  countUnread,
  fetchMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";

function fmtRelative(iso: string) {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationsButton({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const list = useQuery({
    queryKey: ["notifications", userId],
    queryFn: () => fetchMyNotifications(userId),
    refetchInterval: 60_000,
  });

  const unread = countUnread(list.data?.rows ?? []);
  const unavailable = list.data?.unavailable === true;

  const markOne = useMutation({
    mutationFn: (id: string) => markNotificationRead(userId, id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["notifications", userId] });
    },
    onError: (e: Error) => toast.error("Could not update notification", { description: e.message }),
  });

  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(userId),
    onSuccess: async (result) => {
      if (result.unavailable) return;
      await qc.invalidateQueries({ queryKey: ["notifications", userId] });
      toast.success("All notifications marked as read");
    },
    onError: (e: Error) => toast.error("Could not update notifications", { description: e.message }),
  });

  async function openNotification(n: NotificationRow) {
    if (!n.read_at) {
      try {
        await markOne.mutateAsync(n.id);
      } catch {
        /* toast handled in mutation */
      }
    }
    if (n.link_path?.startsWith("/")) {
      // Dynamic paths from trusted DB triggers (not user input).
      void navigate({ to: n.link_path as "/admin/companies" });
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Notifications"
          aria-expanded={open}
          className={cn(
            "relative transition-colors",
            open
              ? "bg-status-applied text-white hover:bg-status-applied hover:text-white"
              : "bg-signal-soft text-signal ring-1 ring-signal/25 hover:bg-signal hover:text-signal-foreground",
          )}
        >
          <Bell className={cn("size-4", open ? "fill-current" : unread > 0 && "fill-signal/25")} aria-hidden />
          {unread > 0 && (
            <span
              className={cn(
                "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ring-2 ring-background",
                open ? "bg-card text-status-applied" : "bg-status-shortlisted text-foreground",
              )}
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(100vw-2rem,22rem)] rounded-xl p-0">
        <div className="flex items-center justify-between gap-2 border-b border-signal/15 bg-signal-soft/40 px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Notifications</p>
          {unread > 0 && !unavailable && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              Mark all as read
            </Button>
          )}
        </div>

        {list.isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : list.isError ? (
          <p className="px-4 py-8 text-center text-sm text-destructive">Could not load notifications.</p>
        ) : unavailable ? (
          <div className="space-y-1 px-4 py-8 text-center">
            <p className="text-sm font-medium">Notifications not enabled yet</p>
            <p className="text-xs text-muted-foreground">
              The notifications table is not on this project. Ask an admin to apply the proposed migration.
            </p>
          </div>
        ) : (list.data?.rows.length ?? 0) === 0 ? (
          <div className="space-y-1 px-4 py-8 text-center">
            <p className="text-sm font-medium">You&apos;re all caught up</p>
            <p className="text-xs text-muted-foreground">New updates about jobs and applications will appear here.</p>
          </div>
        ) : (
          <ScrollArea className="h-80">
            <ul className="divide-y">
              {list.data!.rows.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors hover:bg-accent/60",
                      !n.read_at && "bg-signal-soft/30",
                    )}
                    onClick={() => void openNotification(n)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-snug">{n.title}</p>
                      {!n.read_at && (
                        <span className="mt-1 size-2 shrink-0 rounded-full bg-signal" aria-label="Unread" />
                      )}
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{n.body}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{fmtRelative(n.created_at)}</p>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
