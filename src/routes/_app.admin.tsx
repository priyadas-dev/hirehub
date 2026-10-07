import { createFileRoute, redirect } from "@tanstack/react-router";
import { AdminDashboard } from "@/components/dashboard/AdminDashboard";
import { ROLE_HOME } from "@/lib/auth";

export const Route = createFileRoute("/_app/admin")({
  beforeLoad: ({ context }) => {
    if (context.session.role !== "admin") throw redirect({ to: ROLE_HOME[context.session.role], replace: true });
  },
  head: () => ({
    meta: [
      { title: "Admin overview — HireHub" },
      { name: "description", content: "Manage the HireHub platform." },
      { property: "og:title", content: "Admin overview — HireHub" },
      { property: "og:description", content: "Manage the HireHub platform." },
    ],
  }),
  component: AdminDashboard,
});
