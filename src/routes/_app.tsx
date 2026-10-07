import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppSidebar } from "@/components/shell/AppSidebar";
import { AppHeader } from "@/components/shell/AppHeader";
import { readSession, useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: ({ location }) => {
    if (!readSession()) throw redirect({ to: "/auth", search: { redirect: location.href } });
  },
  component: AppLayout,
});

function AppLayout() {
  const { user } = useAuth();
  const u = user ?? readSession();
  if (!u) return null;
  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar role={u.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader user={u} />
        <main className="mx-auto w-full max-w-6xl flex-1 animate-fade-up px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
