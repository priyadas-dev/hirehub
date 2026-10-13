import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import { CardSkeleton, ErrorState, PageHeader } from "@/components/feedback/States";
import { ContactProfileCard } from "@/components/profile/ContactProfileCard";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { fetchOwnProfile } from "@/lib/profile";

export const Route = createFileRoute("/_app/admin/profile")({
  head: () => ({
    meta: [
      { title: "My profile — HireHub" },
      { name: "description", content: "View and update your admin profile." },
    ],
  }),
  component: AdminProfilePage,
});

function AdminProfilePage() {
  const { user, refresh } = useAuth();
  const id = user?.id;

  const profile = useQuery({
    queryKey: ["admin-profile", id],
    enabled: !!id,
    queryFn: () => fetchOwnProfile(id!),
  });

  if (!user) return null;
  if (profile.isLoading) return <CardSkeleton rows={4} />;
  if (profile.isError) return <ErrorState onRetry={() => void profile.refetch()} />;

  const p = profile.data;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="My profile"
        description="Your account details. Role can only be changed by another admin from Manage Users — not here."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings">
              <Settings /> Settings
            </Link>
          </Button>
        }
      />

      {p ? (
        <ContactProfileCard
          userId={user.id}
          role={user.role}
          email={p.email}
          fullName={p.full_name ?? ""}
          phone={p.phone}
          queryKey={["admin-profile", id]}
          onSaved={async () => {
            await refresh();
            await profile.refetch();
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Profile record not found.</p>
      )}
    </div>
  );
}
