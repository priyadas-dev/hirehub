import { describe, expect, it, vi } from "vitest";
import {
  extractGoogleEventIdFromResourceUri,
  handleGoogleCalendarPush,
  parseGoogleCalendarPushHeaders,
  verifyGoogleCalendarWebhookToken,
} from "@/lib/integrations/google-calendar-webhook";
import { syncInterviewScheduleByGoogleEventId, type RsvpSyncRow } from "@/lib/integrations/interview-rsvp-sync";

const TOKEN = "calendar-webhook-token-32chars!!";
const CHANNEL = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function headers(over: Record<string, string> = {}) {
  return {
    "X-Goog-Channel-ID": CHANNEL,
    "X-Goog-Channel-Token": TOKEN,
    "X-Goog-Resource-ID": "resource-1",
    "X-Goog-Resource-State": "exists",
    "X-Goog-Resource-URI":
      "https://www.googleapis.com/calendar/v3/calendars/primary/events/abcde12345",
    "X-Goog-Message-Number": "1",
    ...over,
  };
}

describe("google-calendar-webhook helpers", () => {
  it("parses Google push headers", () => {
    const parsed = parseGoogleCalendarPushHeaders(headers());
    expect(parsed).toMatchObject({
      channelId: CHANNEL,
      channelToken: TOKEN,
      resourceState: "exists",
      resourceId: "resource-1",
    });
  });

  it("extracts event id from resource URI", () => {
    expect(
      extractGoogleEventIdFromResourceUri(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events/AbCdE12345",
      ),
    ).toBe("abcde12345");
    expect(extractGoogleEventIdFromResourceUri("")).toBeNull();
  });

  it("timing-safe token compare rejects mismatches", () => {
    expect(verifyGoogleCalendarWebhookToken({ provided: TOKEN, expected: TOKEN })).toBe(true);
    expect(
      verifyGoogleCalendarWebhookToken({ provided: "wrong-token-same-length!!!!!!", expected: TOKEN }),
    ).toBe(false);
  });
});

describe("handleGoogleCalendarPush", () => {
  it("returns 401 for wrong channel token and does not sync", async () => {
    const syncOnChange = vi.fn();
    const result = await handleGoogleCalendarPush({
      method: "POST",
      headers: headers({ "X-Goog-Channel-Token": "wrong-token-same-length!!!!!!" }),
      deps: {
        expectedToken: TOKEN,
        isKnownChannel: async () => true,
        syncOnChange,
      },
    });
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ ok: false, error: "Unauthorized" });
    expect(JSON.stringify(result.body)).not.toContain(TOKEN);
    expect(syncOnChange).not.toHaveBeenCalled();
  });

  it("returns 401 for unknown channel id", async () => {
    const syncOnChange = vi.fn();
    const result = await handleGoogleCalendarPush({
      method: "POST",
      headers: headers(),
      deps: {
        expectedToken: TOKEN,
        isKnownChannel: async () => false,
        syncOnChange,
      },
    });
    expect(result.status).toBe(401);
    expect(result.body.error).toBe("Unknown channel");
    expect(syncOnChange).not.toHaveBeenCalled();
  });

  it("acks sync handshake without calling RSVP sync", async () => {
    const syncOnChange = vi.fn();
    const result = await handleGoogleCalendarPush({
      method: "POST",
      headers: headers({ "X-Goog-Resource-State": "sync" }),
      deps: {
        expectedToken: TOKEN,
        isKnownChannel: async () => true,
        syncOnChange,
      },
    });
    expect(result).toEqual({ status: 200, body: { ok: true, state: "sync" } });
    expect(syncOnChange).not.toHaveBeenCalled();
  });

  it("on exists triggers sync with extracted event id", async () => {
    const syncOnChange = vi.fn(async () => ({
      ok: true,
      scanned: 1,
      updated: 1,
      cancelled: 0,
      unchanged: 0,
      errors: 0,
    }));
    const result = await handleGoogleCalendarPush({
      method: "POST",
      headers: headers(),
      deps: {
        expectedToken: TOKEN,
        isKnownChannel: async () => true,
        syncOnChange,
      },
    });
    expect(syncOnChange).toHaveBeenCalledWith("abcde12345");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      state: "exists",
      scanned: 1,
      updated: 1,
    });
    expect(JSON.stringify(result.body)).not.toContain(TOKEN);
  });
});

describe("syncInterviewScheduleByGoogleEventId", () => {
  it("syncs the matching scheduled row when found", async () => {
    const row: RsvpSyncRow = {
      id: "11111111-1111-4111-8111-111111111111",
      status: "scheduled",
      google_event_id: "abcde12345",
      invited_at: "2026-11-01T10:00:00.000Z",
      recruiter_id: "r1",
      seeker_id: "s1",
      recruiter_response: "needsAction",
      seeker_response: "needsAction",
      html_link: null,
      etag: null,
      last_synced_at: null,
      lease_until: null,
    };
    const save = vi.fn(async () => undefined);
    const result = await syncInterviewScheduleByGoogleEventId(
      {
        google: {
          getInterviewEvent: async () =>
            ({
              ok: true,
              outcome: "conference_ready",
              event: {
                eventId: "abcde12345",
                calendarStatus: "confirmed",
                htmlLink: "https://calendar.google.com/event?eid=1",
                etag: '"e2"',
                meetLink: "https://meet.google.com/abc-defg-hij",
                conferenceStatus: "success",
                guestEmails: ["r@example.com", "s@example.com"],
                recruiterResponse: "accepted",
                seekerResponse: "accepted",
                scheduleIdProperty: null,
              },
              conference: { state: "ready", meetLink: "https://meet.google.com/abc-defg-hij" },
              alreadyExisted: true,
              calendarId: "primary",
            }) as never,
        },
        store: {
          listScheduledForRsvpSync: async () => [],
          findScheduledByGoogleEventId: async () => row,
          tryAcquireLease: async () => true,
          releaseLease: async () => undefined,
          save,
          loadAttendeeEmails: async () => ({
            recruiterEmail: "r@example.com",
            seekerEmail: "s@example.com",
          }),
        },
      },
      "abcde12345",
    );
    expect(result).toMatchObject({ ok: true, scanned: 1, updated: 1, errors: 0 });
    expect(save).toHaveBeenCalled();
  });
});
