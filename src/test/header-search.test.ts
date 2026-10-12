import { describe, expect, it } from "vitest";
import { headerSearchPlaceholder, headerSearchTarget } from "@/lib/header-search";

describe("headerSearchTarget", () => {
  it("sends seekers to browse jobs with a trimmed query", () => {
    expect(headerSearchTarget("seeker", "  engineer  ")).toEqual({
      to: "/seeker/jobs",
      search: { q: "engineer" },
    });
  });

  it("sends recruiters to their job posts list", () => {
    expect(headerSearchTarget("recruiter", "frontend")).toEqual({
      to: "/recruiter/jobs",
      search: { q: "frontend" },
    });
  });

  it("sends admins to approve-jobs with optional empty query cleared", () => {
    expect(headerSearchTarget("admin", "   ")).toEqual({
      to: "/admin/jobs",
      search: {},
    });
  });

  it("uses role-specific placeholders", () => {
    expect(headerSearchPlaceholder("seeker")).toMatch(/title, company/i);
    expect(headerSearchPlaceholder("recruiter")).toMatch(/job posts/i);
    expect(headerSearchPlaceholder("admin")).toMatch(/title or company/i);
  });
});
