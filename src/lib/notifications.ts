import { supabase } from "@/integrations/supabase/client";

export type NotificationRow = {
  id: string;
  recipient_id: string;
  type: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  link_path: string | null;
  read_at: string | null;
  created_at: string;
  dedupe_key: string;
};

type PostgrestErrorLike = { code?: string; message?: string };

/** True when PostgREST reports the notifications relation is missing. */
export function isNotificationsUnavailableError(error: PostgrestErrorLike | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    msg.includes("could not find the table") ||
    (msg.includes("relation") && msg.includes("notifications")) ||
    msg.includes("schema cache")
  );
}

/** Untyped until PROPOSED_0005 is applied and `types.ts` regenerated. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function notificationsTable(): any {
  return supabase.from("notifications" as never);
}

export async function fetchMyNotifications(
  userId: string,
  limit = 40,
): Promise<{ rows: NotificationRow[]; unavailable: boolean }> {
  const { data, error } = await notificationsTable()
    .select("id,recipient_id,type,title,body,entity_type,entity_id,link_path,read_at,created_at,dedupe_key")
    .eq("recipient_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isNotificationsUnavailableError(error)) return { rows: [], unavailable: true };
    throw error;
  }
  return { rows: (data as NotificationRow[] | null) ?? [], unavailable: false };
}

export function countUnread(rows: NotificationRow[]): number {
  return rows.filter((n) => !n.read_at).length;
}

export async function markNotificationRead(userId: string, notificationId: string) {
  const { error } = await notificationsTable()
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("recipient_id", userId);
  if (error) {
    if (isNotificationsUnavailableError(error)) return { unavailable: true as const };
    throw error;
  }
  return { unavailable: false as const };
}

export async function markAllNotificationsRead(userId: string) {
  const { error } = await notificationsTable()
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", userId)
    .is("read_at", null);
  if (error) {
    if (isNotificationsUnavailableError(error)) return { unavailable: true as const };
    throw error;
  }
  return { unavailable: false as const };
}
