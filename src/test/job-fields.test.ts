import { describe, expect, it } from "vitest";
import {
  isApplicationDeadlinePassed,
  isDeadlineOnOrAfterToday,
  packJobDescription,
  unpackJobDescription,
} from "@/lib/job-fields";

describe("job-fields deadline helpers", () => {
  it("packs and unpacks deadline markers without exposing them in description", () => {
    const packed = packJobDescription("Build great products.", "2026-12-31");
    expect(packed.startsWith("[[hh:deadline:2026-12-31]]")).toBe(true);
    const unpacked = unpackJobDescription(packed);
    expect(unpacked.applicationDeadline).toBe("2026-12-31");
    expect(unpacked.description).toBe("Build great products.");
  });

  it("treats unmarked descriptions as having no deadline", () => {
    expect(unpackJobDescription("Plain text")).toEqual({
      description: "Plain text",
      applicationDeadline: null,
    });
  });

  it("validates today-or-future deadlines", () => {
    const today = new Date(2026, 9, 9, 15, 0, 0);
    expect(isDeadlineOnOrAfterToday("2026-10-09", today)).toBe(true);
    expect(isDeadlineOnOrAfterToday("2026-10-10", today)).toBe(true);
    expect(isDeadlineOnOrAfterToday("2026-10-08", today)).toBe(false);
  });

  it("closes applications after the deadline day ends", () => {
    const duringDay = new Date(2026, 9, 9, 12, 0, 0);
    const afterDay = new Date(2026, 9, 10, 0, 0, 1);
    expect(isApplicationDeadlinePassed("2026-10-09", duringDay)).toBe(false);
    expect(isApplicationDeadlinePassed("2026-10-09", afterDay)).toBe(true);
  });
});
