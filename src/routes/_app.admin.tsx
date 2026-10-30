import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { wrongRoleHome } from "@/lib/auth";

export const Route = createFileRoute("/_app/admin")({
  beforeLoad: ({ context }) => {
    const home = wrongRoleHome(context.session.role, "admin");
    if (home) throw redirect({ to: home, replace: true });
  },
  component: () => <Outlet />,
});
