import { describe, expect, it, vi } from "vitest";
import {
  GOOGLE_CALENDAR_WATCH_RENEW_CRON_PATH,
  GOOGLE_CALENDAR_WATCH_RENEW_LEAD_MS,
  handleGoogleCalendarWatchRenewRequest,
} from "@/lib/integrations/google-calendar-watch-renew";

describe("google-calendar-watch-renew", () => {
  it("exposes the cron path and renew lead window", () => {
    expect(GOOGLE_CALENDAR_WATCH_RENEW_CRON_PATH).toBe("/api/cron/renew-google-calendar-watch");
    expect(GOOGLE_CALENDAR_WATCH_RENEW_LEAD_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("rejects wrong CRON_SECRET with 401 and never leaks secrets", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "cron-secret-at-least-16";
    try {
      const res = await handleGoogleCalendarWatchRenewRequest(
        new Request("http://localhost/api/cron/renew-google-calendar-watch", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-hirehub-cron-secret": "totally-wrong-secret!",
          },
          body: "{}",
        }),
      );
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ ok: false, error: "Unauthorized" });
      expect(JSON.stringify(body)).not.toContain("cron-secret-at-least-16");
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });

  it("rejects identity fields in the body", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "cron-secret-at-least-16";
    try {
      const res = await handleGoogleCalendarWatchRenewRequest(
        new Request("http://localhost/api/cron/renew-google-calendar-watch", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-hirehub-cron-secret": "cron-secret-at-least-16",
          },
          body: JSON.stringify({ force: true, userId: "u1" }),
        }),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ ok: false });
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
      vi.restoreAllMocks();
    }
  });
});
