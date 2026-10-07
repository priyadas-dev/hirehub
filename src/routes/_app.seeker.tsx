import { createFileRoute, redirect } from "@tanstack/react-router";
import { SeekerDashboard } from "@/components/dashboard/SeekerDashboard";
import { ROLE_HOME } from "@/lib/auth";

export const Route = createFileRoute("/_app/seeker")({
  beforeLoad: ({ context }) => {
    if (context.session.role !== "seeker") throw redirect({ to: ROLE_HOME[context.session.role], replace: true });
  },
  head: () => ({
    meta: [
      { title: "Job Seeker overview — HireHub" },
      { name: "description", content: "Track your job applications on HireHub." },
      { property: "og:title", content: "Job Seeker overview — HireHub" },
      { property: "og:description", content: "Track your job applications on HireHub." },
    ],
  }),
  component: SeekerDashboard,
});
