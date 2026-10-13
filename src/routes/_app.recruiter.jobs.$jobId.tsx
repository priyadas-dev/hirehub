import { createFileRoute, Outlet } from "@tanstack/react-router";

/** Layout for /recruiter/jobs/$jobId and /recruiter/jobs/$jobId/edit */
export const Route = createFileRoute("/_app/recruiter/jobs/$jobId")({
  component: () => <Outlet />,
});
