import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

describe("App routing", () => {
  const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

  it("matches a page for / instead of falling back to not found", () => {
    const matches = router.matchRoutes("/");
    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it.each([
    "/auth",
    "/forgot-password",
    "/reset-password",
    "/seeker",
    "/seeker/jobs",
    "/seeker/jobs/abc",
    "/seeker/applications",
    "/seeker/applications/abc",
    "/seeker/profile",
    "/seeker/saved",
    "/recruiter",
    "/recruiter/applicants",
    "/recruiter/company",
    "/recruiter/jobs",
    "/recruiter/jobs/new",
    "/recruiter/jobs/abc/edit",
    "/admin",
    "/admin/jobs",
    "/admin/companies",
    "/admin/users",
    "/admin/applications",
    "/admin/reports",
  ])("matches application workflow route %s", (path) => {
    const matches = router.matchRoutes(path);
    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });
});
