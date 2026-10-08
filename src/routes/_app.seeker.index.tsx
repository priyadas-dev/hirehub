import { createFileRoute } from "@tanstack/react-router";
import { SeekerDashboard } from "@/components/dashboard/SeekerDashboard";

export const Route = createFileRoute("/_app/seeker/")({
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
