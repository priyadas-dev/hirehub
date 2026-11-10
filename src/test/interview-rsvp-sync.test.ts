import { describe, expect, it, vi } from "vitest";
import type { InterviewEventSuccess, GoogleFailure } from "@/lib/integrations/google-calendar";
import {
  planRsvpSyncFromGoogleResult,
  runInterviewRsvpSyncBatch,
  type RsvpSyncRow,
  type RsvpSyncStore,
} from "@/lib/integrations/interview-rsvp-sync";
import { cronSecretsEqual } from "@/lib/integrations/interview-rsvp-sync.run";

function baseRow(over: Partial<RsvpSyncRow> = {}): RsvpSyncRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    status: "scheduled",
    google_event_id: "abcde12345",
    invited_at: "2026-11-01T10:00:00.000Z",
    recruiter_id: "recruiter-1",
    seeker_id: "seeker-1",
    recruiter_response: "needsAction",
    seeker_response: "needsAction",
    html_link: "https://calendar.google.com/event?eid=1",
    etag: '"etag1"',
    last_synced_at: null,
    lease_until: null,
    ...over,
  };
}

function okEvent(
  over: Partial<InterviewEventSuccess["event"]> = {},
): InterviewEventSuccess {
  const meetLink = "https://meet.google.com/abc-defg-hij";
  const event = {
    eventId: "abcde12345",
    calendarStatus: "confirmed" as const,
    htmlLink: "https://calendar.google.com/event?eid=1",
    etag: '"etag1"',
    meetLink,
    conferenceStatus: "success" as const,
    guestEmails: ["r@example.com", "s@example.com"],
    recruiterResponse: "needsAction" as const,
    seekerResponse: "needsAction" as const,
    scheduleIdProperty: null,
    ...over,
  };
  return {
    ok: true,
    outcome: "conference_ready",
    event,
    conference: { state: "ready", meetLink },
    alreadyExisted: true,
    calendarId: "primary",
  };
}

function fail(reason: string, retryable = false): GoogleFailure {
  return { ok: false, reason, retryable };
}

describe("planRsvpSyncFromGoogleResult", () => {
  const nowIso = "2026-11-10T12:00:00.000Z";

  it("maps accepted / declined / tentative onto response updates", () => {
    const accepted = planRsvpSyncFromGoogleResult({
      row: baseRow(),
      result: okEvent({ recruiterResponse: "accepted", seekerResponse: "tentative" }),
      nowIso,
    });
    expect(accepted.kind).toBe("update");
    if (accepted.kind === "update") {
      expect(accepted.cancelled).toBe(false);
      expect(accepted.patch.recruiterResponse).toBe("accepted");
      expect(accepted.patch.seekerResponse).toBe("tentative");
      expect(accepted.patch.lastSyncedAt).toBe(nowIso);
      expect(accepted.patch.meetLink).toBeUndefined();
    }

    const declined = planRsvpSyncFromGoogleResult({
      row: baseRow(),
      result: okEvent({ seekerResponse: "declined" }),
      nowIso,
    });
    expect(declined.kind).toBe("update");
    if (declined.kind === "update") {
      expect(declined.patch.seekerResponse).toBe("declined");
    }
  });

  it("maps Google cancelled → HireHub cancelled without inventing Meet links", () => {
    const plan = planRsvpSyncFromGoogleResult({
      row: baseRow(),
      result: okEvent({ calendarStatus: "cancelled", meetLink: null }),
      nowIso,
    });
    expect(plan.kind).toBe("update");
    if (plan.kind === "update") {
      expect(plan.cancelled).toBe(true);
      expect(plan.patch.status).toBe("cancelled");
      expect(plan.patch.lastSyncedAt).toBe(nowIso);
      expect(plan.patch.meetLink).toBeUndefined();
    }
  });

  it("unchanged RSVP still bumps last_synced_at (queue rotation)", () => {
    const plan = planRsvpSyncFromGoogleResult({
      row: baseRow({ recruiter_response: "accepted", seeker_response: "accepted" }),
      result: okEvent({ recruiterResponse: "accepted", seekerResponse: "accepted" }),
      nowIso,
    });
    expect(plan).toEqual({ kind: "unchanged", bumpLastSyncedAt: true });
  });

  it("maps auth failures to fatal_auth codes", () => {
    expect(
      planRsvpSyncFromGoogleResult({
        row: baseRow(),
        result: fail("google_auth_revoked"),
        nowIso,
      }),
    ).toEqual({ kind: "fatal_auth", code: "google_auth_revoked" });

    expect(
      planRsvpSyncFromGoogleResult({
        row: baseRow(),
        result: fail("google_not_configured"),
        nowIso,
      }),
    ).toEqual({ kind: "fatal_auth", code: "google_not_configured" });
  });

  it("maps rate-limit to soft_error without a write plan", () => {
    const plan = planRsvpSyncFromGoogleResult({
      row: baseRow(),
      result: fail("google_rate_limited", true),
      nowIso,
    });
    expect(plan).toEqual({
      kind: "soft_error",
      code: "google_rate_limited",
      retryable: true,
    });
  });
});

describe("runInterviewRsvpSyncBatch", () => {
  it("updates accepted, cancels cancelled, bumps unchanged, soft-fails rate-limit, aborts on auth", async () => {
    const saves: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const rowOk = baseRow({ id: "a0000000-0000-4000-8000-000000000001" });
    const rowCancel = baseRow({ id: "a0000000-0000-4000-8000-000000000002" });
    const rowSame = baseRow({
      id: "a0000000-0000-4000-8000-000000000003",
      recruiter_response: "accepted",
      seeker_response: "accepted",
    });
    const rowRate = baseRow({ id: "a0000000-0000-4000-8000-000000000004" });

    const store: RsvpSyncStore = {
      listScheduledForRsvpSync: async () => [rowOk, rowCancel, rowSame, rowRate],
      tryAcquireLease: async () => true,
      releaseLease: async () => undefined,
      save: async (id, patch) => {
        saves.push({ id, patch: { ...patch } });
      },
      loadAttendeeEmails: async () => ({
        recruiterEmail: "r@example.com",
        seekerEmail: "s@example.com",
      }),
    };

    const queue: Array<InterviewEventSuccess | GoogleFailure> = [
      okEvent({ recruiterResponse: "accepted", seekerResponse: "needsAction" }),
      okEvent({ calendarStatus: "cancelled" }),
      okEvent({ recruiterResponse: "accepted", seekerResponse: "accepted" }),
      fail("google_rate_limited", true),
    ];
    const getInterviewEvent = vi.fn(async () => {
      const next = queue.shift();
      if (!next) return fail("google_unavailable", true);
      return next;
    });

    const result = await runInterviewRsvpSyncBatch({
      store,
      google: { getInterviewEvent },
      now: () => new Date("2026-11-10T12:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    expect(result.scanned).toBe(4);
    expect(result.updated).toBe(1);
    expect(result.cancelled).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(result.errors).toBe(1);

    expect(saves.some((s) => s.patch.recruiterResponse === "accepted")).toBe(true);
    expect(saves.some((s) => s.patch.status === "cancelled")).toBe(true);
    expect(saves.some((s) => Object.keys(s.patch).length === 1 && s.patch.lastSyncedAt)).toBe(
      true,
    );
    // Rate-limit: no save for that row
    expect(saves).toHaveLength(3);
  });

  it("stops the batch on google_auth_revoked and does not claim success", async () => {
    const store: RsvpSyncStore = {
      listScheduledForRsvpSync: async () => [baseRow()],
      tryAcquireLease: async () => true,
      releaseLease: async () => undefined,
      save: async () => {
        throw new Error("should not save");
      },
      loadAttendeeEmails: async () => ({
        recruiterEmail: "r@example.com",
        seekerEmail: "s@example.com",
      }),
    };

    const result = await runInterviewRsvpSyncBatch({
      store,
      google: {
        getInterviewEvent: async () => fail("google_auth_revoked"),
      },
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("google_auth_revoked");
    expect(result.errors).toBe(1);
    expect(result.updated).toBe(0);
  });

  it("skips cancelled rows by selection contract (store never returns them)", async () => {
    const store: RsvpSyncStore = {
      listScheduledForRsvpSync: async () => [],
      tryAcquireLease: async () => true,
      releaseLease: async () => undefined,
      save: async () => undefined,
      loadAttendeeEmails: async () => null,
    };
    const result = await runInterviewRsvpSyncBatch({
      store,
      google: { getInterviewEvent: async () => fail("google_not_configured") },
    });
    expect(result).toMatchObject({
      ok: true,
      scanned: 0,
      updated: 0,
      cancelled: 0,
      errors: 0,
    });
  });
});

describe("cronSecretsEqual", () => {
  it("matches equal secrets and rejects length/mismatch", () => {
    expect(cronSecretsEqual("abcdefghijklmnop", "abcdefghijklmnop")).toBe(true);
    expect(cronSecretsEqual("abcdefghijklmnop", "abcdefghijklmnoX")).toBe(false);
    expect(cronSecretsEqual("short", "abcdefghijklmnop")).toBe(false);
  });
});
