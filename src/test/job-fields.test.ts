import { describe, expect, it } from "vitest";
import {
  dhakaToday,
  isApplicationDeadlinePassed,
  isDeadlineOnOrAfterToday,
  jobDeadline,
  unpackJobDescription,
} from "@/lib/job-fields";

describe("job-fields deadline helpers", () => {
  it("prefers the database column over a legacy marker", () => {
    expect(jobDeadline({ application_deadline: "2026-12-31", description: "[[hh:deadline:2026-01-01]]\nx" })).toBe(
      "2026-12-31",
    );
    expect(jobDeadline({ application_deadline: null, description: "[[hh:deadline:2026-01-01]]\nx" })).toBe(
      "2026-01-01",
    );
  });

  it("strips legacy markers from descriptions", () => {
    expect(unpackJobDescription("[[hh:deadline:2026-12-31]]\nBuild.").description).toBe("Build.");
    expect(unpackJobDescription("Plain text")).toEqual({ description: "Plain text", applicationDeadline: null });
  });

  it("uses the Asia/Dhaka calendar day", () => {
    // 2026-10-09 18:30 UTC = 2026-10-10 00:30 in Dhaka
    expect(dhakaToday(new Date("2026-10-09T18:30:00Z"))).toBe("2026-10-10");
    expect(dhakaToday(new Date("2026-10-09T17:59:00Z"))).toBe("2026-10-09");
  });

  it("validates today-or-future deadlines in Dhaka", () => {
    const now = new Date("2026-10-09T09:00:00Z");
    expect(isDeadlineOnOrAfterToday("2026-10-09", now)).toBe(true);
    expect(isDeadlineOnOrAfterToday("2026-10-08", now)).toBe(false);
  });

  it("closes applications after the deadline day ends in Dhaka", () => {
    expect(isApplicationDeadlinePassed("2026-10-09", new Date("2026-10-09T17:59:59Z"))).toBe(false);
    expect(isApplicationDeadlinePassed("2026-10-09", new Date("2026-10-09T18:00:01Z"))).toBe(true);
    expect(isApplicationDeadlinePassed(null)).toBe(false);
  });
});
