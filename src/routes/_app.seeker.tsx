import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { wrongRoleHome } from "@/lib/auth";

export const Route = createFileRoute("/_app/seeker")({
  beforeLoad: ({ context }) => {
    const home = wrongRoleHome(context.session.role, "seeker");
    if (home) throw redirect({ to: home, replace: true });
  },
  component: () => <Outlet />,
});
