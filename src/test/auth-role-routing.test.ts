import { describe, expect, it } from "vitest";
import {
  mapDbRole,
  normalizeAuthRedirect,
  resolvePostAuthPath,
  ROLE_HOME,
  workspaceWelcomeDescription,
} from "@/lib/auth";

describe("mapDbRole", () => {
  it("maps database enum values to app roles", () => {
    expect(mapDbRole("job_seeker")).toBe("seeker");
    expect(mapDbRole("recruiter")).toBe("recruiter");
    expect(mapDbRole("admin")).toBe("admin");
  });

  it("does not invent seeker when role is missing or unknown", () => {
    expect(mapDbRole(null)).toBeNull();
    expect(mapDbRole(undefined)).toBeNull();
    expect(mapDbRole("")).toBeNull();
    expect(mapDbRole("superuser")).toBeNull();
  });
});

describe("normalizeAuthRedirect", () => {
  const origin = "http://localhost:8080";

  it("keeps same-origin path redirects", () => {
    expect(normalizeAuthRedirect("/recruiter/jobs", origin)).toBe("/recruiter/jobs");
    expect(normalizeAuthRedirect("/seeker?x=1", origin)).toBe("/seeker?x=1");
  });

  it("converts absolute same-origin hrefs to paths", () => {
    expect(normalizeAuthRedirect("http://localhost:8080/recruiter", origin)).toBe("/recruiter");
    expect(normalizeAuthRedirect("http://localhost:8080/admin/jobs?q=1", origin)).toBe("/admin/jobs?q=1");
  });

  it("rejects other origins and protocols", () => {
    expect(normalizeAuthRedirect("https://evil.example/recruiter", origin)).toBeUndefined();
    expect(normalizeAuthRedirect("//evil.example/recruiter", origin)).toBeUndefined();
  });
});

describe("resolvePostAuthPath", () => {
  const origin = "http://localhost:8080";

  it("sends each role to its workspace home", () => {
    expect(resolvePostAuthPath("seeker", undefined)).toBe("/seeker");
    expect(resolvePostAuthPath("recruiter", undefined)).toBe("/recruiter");
    expect(resolvePostAuthPath("admin", undefined)).toBe("/admin");
  });

  it("ignores a stale seeker redirect for recruiters and admins", () => {
    expect(resolvePostAuthPath("recruiter", "/seeker")).toBe("/recruiter");
    expect(resolvePostAuthPath("recruiter", "/seeker/jobs")).toBe("/recruiter");
    expect(resolvePostAuthPath("admin", "/seeker")).toBe("/admin");
    expect(resolvePostAuthPath("recruiter", "http://localhost:8080/seeker", origin)).toBe("/recruiter");
  });

  it("honors same-role deep links and shared settings", () => {
    expect(resolvePostAuthPath("recruiter", "/recruiter/jobs/new")).toBe("/recruiter/jobs/new");
    expect(resolvePostAuthPath("seeker", "/seeker/applications")).toBe("/seeker/applications");
    expect(resolvePostAuthPath("admin", "/settings")).toBe("/settings");
    expect(resolvePostAuthPath("admin", "http://localhost:8080/admin/users", origin)).toBe("/admin/users");
    expect(resolvePostAuthPath("recruiter", "/dashboard")).toBe(ROLE_HOME.recruiter);
  });

  it("rejects open redirects and auth loops", () => {
    expect(resolvePostAuthPath("recruiter", "//evil.example")).toBe("/recruiter");
    expect(resolvePostAuthPath("recruiter", "/auth")).toBe("/recruiter");
    expect(resolvePostAuthPath("seeker", "https://evil.example")).toBe("/seeker");
  });
});

describe("workspaceWelcomeDescription", () => {
  it("describes the correct workspace without admin signup lectures on seeker/recruiter login", () => {
    expect(workspaceWelcomeDescription("recruiter")).toBe("Opening your recruiter workspace.");
    expect(workspaceWelcomeDescription("seeker")).toBe("Opening your job seeker workspace.");
    expect(workspaceWelcomeDescription("seeker")).not.toMatch(/role=admin/i);
    expect(workspaceWelcomeDescription("seeker")).not.toMatch(/Admin access/i);
    expect(workspaceWelcomeDescription("recruiter")).not.toMatch(/Admin access/i);
    expect(workspaceWelcomeDescription("admin")).toBe("Opening your admin workspace.");
  });
});
