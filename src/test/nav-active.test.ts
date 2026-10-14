import { describe, expect, it } from "vitest";
import { isNavItemActive } from "@/components/shell/AppSidebar";

describe("isNavItemActive", () => {
  it("activates role home only on the exact path", () => {
    expect(isNavItemActive("/recruiter", "/recruiter")).toBe(true);
    expect(isNavItemActive("/recruiter", "/recruiter/jobs")).toBe(false);
    expect(isNavItemActive("/admin", "/admin/jobs")).toBe(false);
    expect(isNavItemActive("/seeker", "/seeker/applications")).toBe(false);
  });

  it("separates Post a Job from My Job Posts", () => {
    expect(isNavItemActive("/recruiter/jobs/new", "/recruiter/jobs/new")).toBe(true);
    expect(isNavItemActive("/recruiter/jobs", "/recruiter/jobs/new")).toBe(false);
    expect(isNavItemActive("/recruiter/jobs", "/recruiter/jobs")).toBe(true);
    expect(isNavItemActive("/recruiter/jobs", "/recruiter/jobs/abc-123")).toBe(true);
  });

  it("keeps applications and nested application detail together", () => {
    expect(isNavItemActive("/seeker/applications", "/seeker/applications")).toBe(true);
    expect(isNavItemActive("/seeker/applications", "/seeker/applications/xyz")).toBe(true);
    expect(isNavItemActive("/seeker", "/seeker/applications")).toBe(false);
  });
});
