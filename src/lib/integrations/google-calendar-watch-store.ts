/**
 * Service-role store for google_calendar_watch_channels (PROPOSED_0028).
 * Never stores the webhook token — that stays in env only.
 */

export type GoogleCalendarWatchRow = {
  id: string;
  channel_id: string;
  resource_id: string;
  calendar_id: string;
  expiration_ms: number | null;
  created_at: string;
  updated_at: string;
};

type WatchAdmin = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        maybeSingle: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
      limit: (n: number) => Promise<{
        data: Record<string, unknown>[] | null;
        error: { message: string } | null;
      }>;
    };
    upsert: (
      row: Record<string, unknown>,
      opts: { onConflict: string },
    ) => Promise<{ error: { message: string } | null }>;
    delete: () => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
  };
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

export function mapGoogleCalendarWatchRow(raw: Record<string, unknown>): GoogleCalendarWatchRow {
  return {
    id: str(raw["id"]),
    channel_id: str(raw["channel_id"]),
    resource_id: str(raw["resource_id"]),
    calendar_id: str(raw["calendar_id"]) || "primary",
    expiration_ms: numOrNull(raw["expiration_ms"]),
    created_at: str(raw["created_at"]),
    updated_at: str(raw["updated_at"]),
  };
}

export function createGoogleCalendarWatchStore(admin: WatchAdmin) {
  return {
    async getByCalendarId(calendarId: string): Promise<GoogleCalendarWatchRow | null> {
      const { data, error } = await admin
        .from("google_calendar_watch_channels")
        .select("*")
        .eq("calendar_id", calendarId.trim() || "primary")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? mapGoogleCalendarWatchRow(data) : null;
    },

    async getByChannelId(channelId: string): Promise<GoogleCalendarWatchRow | null> {
      const { data, error } = await admin
        .from("google_calendar_watch_channels")
        .select("*")
        .eq("channel_id", channelId.trim())
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? mapGoogleCalendarWatchRow(data) : null;
    },

    async upsertActive(input: {
      channelId: string;
      resourceId: string;
      calendarId: string;
      expirationMs: number | null;
    }): Promise<void> {
      const now = new Date().toISOString();
      const { error } = await admin.from("google_calendar_watch_channels").upsert(
        {
          channel_id: input.channelId.trim(),
          resource_id: input.resourceId.trim(),
          calendar_id: input.calendarId.trim() || "primary",
          expiration_ms: input.expirationMs,
          updated_at: now,
        },
        { onConflict: "calendar_id" },
      );
      if (error) throw new Error(error.message);
    },

    async deleteByCalendarId(calendarId: string): Promise<void> {
      const { error } = await admin
        .from("google_calendar_watch_channels")
        .delete()
        .eq("calendar_id", calendarId.trim() || "primary");
      if (error) throw new Error(error.message);
    },
  };
}

export type GoogleCalendarWatchStore = ReturnType<typeof createGoogleCalendarWatchStore>;
