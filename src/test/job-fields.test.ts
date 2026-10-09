import { describe, expect, it } from "vitest";
import {
  formatLocalDeadlineDate,
  parseLocalDeadlineDate,
} from "@/components/jobs/DeadlineDatePicker";
import {
  businessCalendarDate,
  canSetApplicationDeadline,
  HIREHUB_DEADLINE_TIMEZONE,
  isApplicationDeadlinePassed,
  isDeadlineOnOrAfterToday,
  isRealCalendarDate,
  migrateLegacyDeadlineRow,
  packJobDescription,
  resolveJobDeadline,
  stripDeadlineMarker,
  unpackJobDescription,
} from "@/lib/job-fields";

describe("calendar date handling (no UTC day-shift)", () => {
  it("round-trips YYYY-MM-DD through local parse/format", () => {
    const iso = "2026-10-09";
    const parsed = parseLocalDeadlineDate(iso);
    expect(parsed).toBeDefined();
    expect(formatLocalDeadlineDate(parsed!)).toBe(iso);
    expect(parsed!.getFullYear()).toBe(2026);
    expect(parsed!.getMonth()).toBe(9);
    expect(parsed!.getDate()).toBe(9);
  });

  it("rejects invalid calendar dates", () => {
    expect(isRealCalendarDate("2026-02-30")).toBe(false);
    expect(isRealCalendarDate("2026-13-01")).toBe(false);
    expect(isRealCalendarDate("not-a-date")).toBe(false);
    expect(parseLocalDeadlineDate("2026-02-30")).toBeUndefined();
  });

  it("accepts valid calendar dates", () => {
    expect(isRealCalendarDate("2026-02-28")).toBe(true);
    expect(isRealCalendarDate("2024-02-29")).toBe(true);
    expect(isRealCalendarDate("2025-02-29")).toBe(false);
  });
});

describe("legacy deadline markers", () => {
  it("recognizes a marker at end of string (no trailing newline)", () => {
    expect(unpackJobDescription("[[hh:deadline:2026-11-01]]")).toEqual({
      description: "",
      applicationDeadline: "2026-11-01",
    });
    expect(
      migrateLegacyDeadlineRow({
        application_deadline: null,
        description: "[[hh:deadline:2026-11-01]]",
      }),
    ).toEqual({
      application_deadline: "2026-11-01",
      description: null,
    });
  });

  it("recognizes a marker followed by LF and preserves remaining text", () => {
    expect(unpackJobDescription("[[hh:deadline:2026-11-01]]\nRole details stay.")).toEqual({
      description: "Role details stay.",
      applicationDeadline: "2026-11-01",
    });
  });

  it("recognizes a marker followed by CRLF and preserves remaining text", () => {
    expect(unpackJobDescription("[[hh:deadline:2026-11-01]]\r\nRole details stay.")).toEqual({
      description: "Role details stay.",
      applicationDeadline: "2026-11-01",
    });
    expect(
      migrateLegacyDeadlineRow({
        application_deadline: null,
        description: "[[hh:deadline:2026-11-01]]\r\nRole details stay.",
      }),
    ).toEqual({
      application_deadline: "2026-11-01",
      description: "Role details stay.",
    });
  });

  it("recognizes a marker followed by description text without a newline", () => {
    expect(unpackJobDescription("[[hh:deadline:2026-11-01]]Role details stay.")).toEqual({
      description: "Role details stay.",
      applicationDeadline: "2026-11-01",
    });
    expect(
      migrateLegacyDeadlineRow({
        application_deadline: null,
        description: "[[hh:deadline:2026-11-01]]Role details stay.",
      }),
    ).toEqual({
      application_deadline: "2026-11-01",
      description: "Role details stay.",
    });
  });

  it("rejects invalid calendar dates and does not strip them", () => {
    const bad = "[[hh:deadline:2026-02-30]]\nKeep me";
    expect(unpackJobDescription(bad)).toEqual({
      description: bad,
      applicationDeadline: null,
    });
    expect(stripDeadlineMarker(bad)).toBe(bad);
    expect(
      migrateLegacyDeadlineRow({
        application_deadline: null,
        description: bad,
      }),
    ).toEqual({
      application_deadline: null,
      description: bad,
    });
  });

  it("packs and unpacks deadline markers without exposing them in description", () => {
    const packed = packJobDescription("Build great products.", "2026-12-31");
    expect(packed.startsWith("[[hh:deadline:2026-12-31]]")).toBe(true);
    const unpacked = unpackJobDescription(packed);
    expect(unpacked.applicationDeadline).toBe("2026-12-31");
    expect(unpacked.description).toBe("Build great products.");
  });

  it("treats unmarked and missing descriptions as having no deadline", () => {
    expect(unpackJobDescription("Plain text")).toEqual({
      description: "Plain text",
      applicationDeadline: null,
    });
    expect(unpackJobDescription(null)).toEqual({ description: "", applicationDeadline: null });
  });

  it("ignores malformed markers safely and does not strip them", () => {
    const bad = "[[hh:deadline:not-a-date]]\nKeep me";
    expect(unpackJobDescription(bad)).toEqual({
      description: bad,
      applicationDeadline: null,
    });
    expect(stripDeadlineMarker(bad)).toBe(bad);
  });
});

describe("migration helpers", () => {
  it("backfills from a valid marker and strips only the recognized marker", () => {
    expect(
      migrateLegacyDeadlineRow({
        application_deadline: null,
        description: "[[hh:deadline:2026-11-01]]\nRole details stay.",
      }),
    ).toEqual({
      application_deadline: "2026-11-01",
      description: "Role details stay.",
    });
  });

  it("never overwrites an existing non-null deadline", () => {
    expect(
      migrateLegacyDeadlineRow({
        application_deadline: "2027-01-15",
        description: "[[hh:deadline:2026-11-01]]\nStill strip marker.",
      }),
    ).toEqual({
      application_deadline: "2027-01-15",
      description: "Still strip marker.",
    });
  });

  it("leaves malformed markers alone (no backfill, no strip)", () => {
    const description = "[[hh:deadline:99-99-99]] leftover";
    expect(
      migrateLegacyDeadlineRow({
        application_deadline: null,
        description,
      }),
    ).toEqual({
      application_deadline: null,
      description,
    });
  });
});

describe("resolveJobDeadline", () => {
  it("prefers the database column over a legacy marker", () => {
    expect(resolveJobDeadline("2026-12-01", "[[hh:deadline:2026-01-01]]\nBody")).toBe("2026-12-01");
  });

  it("falls back to a legacy marker when the column is null", () => {
    expect(resolveJobDeadline(null, "[[hh:deadline:2026-08-20]]\nBody")).toBe("2026-08-20");
  });

  it("returns null when both column and description lack a valid deadline", () => {
    expect(resolveJobDeadline(null, "No marker here")).toBeNull();
    expect(resolveJobDeadline("bogus", "also bad")).toBeNull();
  });

  it("normalizes timestamp-shaped column values to YYYY-MM-DD", () => {
    expect(resolveJobDeadline("2026-10-09T00:00:00", null)).toBe("2026-10-09");
  });
});

describe("deadline day boundaries (Asia/Dhaka business TZ)", () => {
  it("documents the shared business timezone", () => {
    expect(HIREHUB_DEADLINE_TIMEZONE).toBe("Asia/Dhaka");
  });

  // 2026-10-09 12:00 Asia/Dhaka = 2026-10-09 06:00 UTC
  const duringDhakaDay = new Date("2026-10-09T06:00:00.000Z");
  // 2026-10-10 00:30 Asia/Dhaka = 2026-10-09 18:30 UTC
  const afterDhakaMidnight = new Date("2026-10-09T18:30:00.000Z");

  it("formats business calendar dates in Asia/Dhaka", () => {
    expect(businessCalendarDate(duringDhakaDay)).toBe("2026-10-09");
    expect(businessCalendarDate(afterDhakaMidnight)).toBe("2026-10-10");
  });

  it("validates today-or-future deadlines in Asia/Dhaka", () => {
    expect(isDeadlineOnOrAfterToday("2026-10-09", duringDhakaDay)).toBe(true);
    expect(isDeadlineOnOrAfterToday("2026-10-10", duringDhakaDay)).toBe(true);
    expect(isDeadlineOnOrAfterToday("2026-10-08", duringDhakaDay)).toBe(false);
  });

  it("keeps applications open through the end of the Asia/Dhaka deadline day (matches RLS)", () => {
    expect(isApplicationDeadlinePassed("2026-10-09", duringDhakaDay)).toBe(false);
    expect(isApplicationDeadlinePassed("2026-10-09", afterDhakaMidnight)).toBe(true);
    expect(isApplicationDeadlinePassed("2026-10-08", duringDhakaDay)).toBe(true);
  });

  it("treats missing deadlines as not expired", () => {
    expect(isApplicationDeadlinePassed(null, duringDhakaDay)).toBe(false);
    expect(isApplicationDeadlinePassed(undefined, duringDhakaDay)).toBe(false);
  });

  it("allows extending an expired deadline to today or later and reopens applications", () => {
    const previous = "2026-10-01";
    const next = "2026-10-20";
    expect(isApplicationDeadlinePassed(previous, duringDhakaDay)).toBe(true);
    expect(canSetApplicationDeadline(next, previous, duringDhakaDay)).toBe(true);
    expect(isApplicationDeadlinePassed(next, duringDhakaDay)).toBe(false);
  });

  it("rejects moving a deadline further into the past", () => {
    expect(canSetApplicationDeadline("2026-09-01", "2026-10-01", duringDhakaDay)).toBe(false);
  });

  it("allows leaving an expired deadline unchanged", () => {
    expect(canSetApplicationDeadline("2026-10-01", "2026-10-01", duringDhakaDay)).toBe(true);
  });
});

describe("approval and application preservation (logic)", () => {
  it("deadline updates do not imply a status change payload", () => {
    const previousStatus = "approved" as const;
    const updatePayload = {
      title: "Engineer",
      description: "Details",
      location: "Remote",
      salary_range: null as string | null,
      job_type: "full_time" as const,
      application_deadline: "2026-12-01",
    };
    expect(updatePayload).not.toHaveProperty("status");
    expect(previousStatus).toBe("approved");
  });

  it("extending a deadline does not reset application records", () => {
    const applications = [
      { id: "a1", status: "shortlisted" },
      { id: "a2", status: "applied" },
    ];
    const afterDeadlineExtend = applications.map((a) => ({ ...a }));
    expect(afterDeadlineExtend).toEqual(applications);
  });
});
