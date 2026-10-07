import { createFileRoute, redirect } from "@tanstack/react-router";
import { Overview } from "@/components/dashboard/Overview";
import { ROLE_HOME } from "@/lib/auth";

export const Route = createFileRoute("/_app/recruiter")({
  beforeLoad: ({ context }) => {
    if (context.session.role !== "recruiter") throw redirect({ to: ROLE_HOME[context.session.role], replace: true });
  },
  head: () => ({
    meta: [
      { title: "Recruiter overview — HireHub" },
      { name: "description", content: "Manage your listings and candidates on HireHub." },
      { property: "og:title", content: "Recruiter overview — HireHub" },
      { property: "og:description", content: "Manage your listings and candidates on HireHub." },
    ],
  }),
  component: Overview,
});
