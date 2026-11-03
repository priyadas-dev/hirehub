import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { wrongRoleHome } from "@/lib/auth";

export const Route = createFileRoute("/_app/recruiter")({
  beforeLoad: ({ context }) => {
    const home = wrongRoleHome(context.session.role, "recruiter");
    if (home) throw redirect({ to: home, replace: true });
  },
  component: () => <Outlet />,
});
