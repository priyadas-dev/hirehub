import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, UserCircle } from "lucide-react";
import { CardSkeleton, ErrorState, PageHeader } from "@/components/feedback/States";
import { ContactProfileCard } from "@/components/profile/ContactProfileCard";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";
import { DeleteProfileSection } from "@/components/settings/DeleteProfileSection";
import { ForgetAgentMemorySection } from "@/components/settings/ForgetAgentMemorySection";
import { Button } from "@/components/ui/button";
import { ROLE_HOME, useAuth } from "@/lib/auth";
import { fetchOwnProfile } from "@/lib/profile";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({
    meta: [
      { title: "Settings — HireHub" },
      { name: "description", content: "Edit your profile, password, or delete your account to sign up again." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, refresh } = useAuth();
  const id = user?.id;

  const profile = useQuery({
    queryKey: ["own-profile", id],
    enabled: !!id,
    queryFn: () => fetchOwnProfile(id!),
  });

  if (!user) return null;
  if (profile.isLoading) return <CardSkeleton rows={6} />;
  if (profile.isError) return <ErrorState onRetry={() => void profile.refetch()} />;

  const p = profile.data;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Update the profile fields you are allowed to change, manage your password, or delete your account and sign up again as a Job Seeker or Recruiter."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to={ROLE_HOME[user.role]}>Back to dashboard</Link>
          </Button>
        }
      />

      {p && (
        <ContactProfileCard
          userId={user.id}
          role={user.role}
          email={p.email}
          fullName={p.full_name ?? ""}
          phone={p.phone}
          queryKey={["own-profile", id]}
          onSaved={async () => {
            await refresh();
            await profile.refetch();
          }}
          initiallyEditing
        />
      )}

      {user.role === "recruiter" && (
        <section className="surface-card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex gap-3">
            <Building2 className="mt-0.5 size-5 text-signal" aria-hidden />
            <div>
              <h2 className="text-base font-semibold">Company profile</h2>
              <p className="text-sm text-muted-foreground">
                Edit company name, industry, website, and preview a logo on your company profile page.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/recruiter/company">Open company profile</Link>
          </Button>
        </section>
      )}

      {user.role === "seeker" && (
        <section className="surface-card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex gap-3">
            <UserCircle className="mt-0.5 size-5 text-signal" aria-hidden />
            <div>
              <h2 className="text-base font-semibold">Resume link</h2>
              <p className="text-sm text-muted-foreground">
                Manage your preferred resume URL on your seeker profile page.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/seeker/profile">Open full profile</Link>
          </Button>
        </section>
      )}

      {user.role === "admin" && (
        <section className="surface-card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex gap-3">
            <UserCircle className="mt-0.5 size-5 text-signal" aria-hidden />
            <div>
              <h2 className="text-base font-semibold">Admin profile</h2>
              <p className="text-sm text-muted-foreground">View your account details on your profile page. Role stays read-only.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/admin/profile">Open profile</Link>
          </Button>
        </section>
      )}

      <section className="surface-card max-w-xl space-y-4 p-5 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Password</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Passwords are handled by Supabase Auth and are never stored in HireHub tables or logs.
          </p>
        </div>
        <ChangePasswordForm email={user.email} />
      </section>

      <ForgetAgentMemorySection />

      <DeleteProfileSection currentRole={user.role} />
    </div>
  );
}
