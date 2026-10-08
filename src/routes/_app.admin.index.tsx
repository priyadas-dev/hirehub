import { createFileRoute } from "@tanstack/react-router";
import { AdminDashboard } from "@/components/dashboard/AdminDashboard";

export const Route = createFileRoute("/_app/admin/")({
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
