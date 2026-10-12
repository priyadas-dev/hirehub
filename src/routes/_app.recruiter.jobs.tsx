import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/recruiter/jobs")({
  component: () => <Outlet />,
});
