import { describe, expect, it } from "vitest";
import {
  countUnread,
  isNotificationsUnavailableError,
  type NotificationRow,
} from "@/lib/notifications";

describe("notifications helpers", () => {
  it("counts unread rows only", () => {
    const rows: NotificationRow[] = [
      {
        id: "1",
        recipient_id: "u",
        type: "job_approved",
        title: "a",
        body: "b",
        entity_type: null,
        entity_id: null,
        link_path: null,
        read_at: null,
        created_at: new Date().toISOString(),
        dedupe_key: "k1",
      },
      {
        id: "2",
        recipient_id: "u",
        type: "job_closed",
        title: "a",
        body: "b",
        entity_type: null,
        entity_id: null,
        link_path: null,
        read_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        dedupe_key: "k2",
      },
    ];
    expect(countUnread(rows)).toBe(1);
  });

  it("detects missing-table PostgREST errors", () => {
    expect(isNotificationsUnavailableError({ code: "PGRST205", message: "Could not find the table" })).toBe(true);
    expect(isNotificationsUnavailableError({ message: "relation \"notifications\" does not exist" })).toBe(true);
    expect(isNotificationsUnavailableError({ message: "permission denied" })).toBe(false);
  });
});
