import { createFileRoute, redirect } from "@tanstack/react-router";
import { ROLE_HOME } from "@/lib/auth";

// Sends each person to the area matching their stored role.
export const Route = createFileRoute("/_app/dashboard")({
  beforeLoad: ({ context }) => {
    throw redirect({ to: ROLE_HOME[context.session.role], replace: true });
  },
});
