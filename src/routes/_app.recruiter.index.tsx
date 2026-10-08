import { createFileRoute } from "@tanstack/react-router";
import { RecruiterDashboard } from "@/components/dashboard/RecruiterDashboard";

export const Route = createFileRoute("/_app/recruiter/")({
  head: () => ({
    meta: [
      { title: "Recruiter overview — HireHub" },
      { name: "description", content: "Manage your listings and candidates on HireHub." },
      { property: "og:title", content: "Recruiter overview — HireHub" },
      { property: "og:description", content: "Manage your listings and candidates on HireHub." },
    ],
  }),
  component: RecruiterDashboard,
});
