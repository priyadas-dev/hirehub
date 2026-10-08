import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { ROLE_HOME } from "@/lib/auth";

export const Route = createFileRoute("/_app/admin")({
  beforeLoad: ({ context }) => {
    if (context.session.role !== "admin") throw redirect({ to: ROLE_HOME[context.session.role], replace: true });
  },
  component: () => <Outlet />,
});
