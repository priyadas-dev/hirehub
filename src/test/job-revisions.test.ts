import { describe, expect, it } from "vitest";
import {
  canDirectEditLiveJob,
  canSubmitJobRevision,
  diffJobContent,
  jobContentChanged,
  normalizeJobContent,
} from "@/lib/job-revisions";

const base = {
  title: "Engineer",
  description: "Build things",
  location: "Dhaka",
  salary_range: "80k",
  job_type: "full_time" as const,
  application_deadline: "2026-12-01",
};

describe("job revisions helpers", () => {
  it("allows revision only for owned approved jobs without pending revision", () => {
    expect(
      canSubmitJobRevision({ jobStatus: "approved", hasPendingRevision: false, isOwner: true }).ok,
    ).toBe(true);
    expect(
      canSubmitJobRevision({ jobStatus: "pending", hasPendingRevision: false, isOwner: true }).ok,
    ).toBe(false);
    expect(
      canSubmitJobRevision({ jobStatus: "approved", hasPendingRevision: true, isOwner: true }).ok,
    ).toBe(false);
    expect(
      canSubmitJobRevision({ jobStatus: "approved", hasPendingRevision: false, isOwner: false }).ok,
    ).toBe(false);
  });

  it("allows direct live edit only while pending", () => {
    expect(canDirectEditLiveJob("pending")).toBe(true);
    expect(canDirectEditLiveJob("approved")).toBe(false);
  });

  it("diffs changed fields for admin before/after", () => {
    const proposed = normalizeJobContent({ ...base, title: "Senior Engineer", location: "Remote" });
    expect(jobContentChanged(base, proposed)).toBe(true);
    const diffs = diffJobContent(base, proposed);
    expect(diffs.map((d) => d.field).sort()).toEqual(["location", "title"]);
    expect(diffs.find((d) => d.field === "title")?.after).toBe("Senior Engineer");
  });

  it("treats whitespace-only as unchanged nullables", () => {
    expect(
      jobContentChanged(
        { ...base, description: null },
        { ...base, description: "   " },
      ),
    ).toBe(false);
  });
});
