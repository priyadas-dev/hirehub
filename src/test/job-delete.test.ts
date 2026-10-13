import { describe, expect, it } from "vitest";
import { canDeleteJobWithApplications } from "@/lib/job-delete";

describe("job delete safety", () => {
  it("allows delete when there are no applications", () => {
    expect(canDeleteJobWithApplications(0)).toEqual({ ok: true });
  });

  it("blocks delete when applications exist so cascade cannot wipe them", () => {
    const result = canDeleteJobWithApplications(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/application/i);
      expect(result.reason).toMatch(/Close/i);
    }
  });
});
