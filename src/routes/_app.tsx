import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppSidebar } from "@/components/shell/AppSidebar";
import { AppHeader } from "@/components/shell/AppHeader";
import { readSession, useAuth } from "@/lib/auth";
import { APP_CONTENT_SHELL } from "@/lib/shell-layout";

export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const session = await readSession();
    if (!session) throw redirect({ to: "/auth", search: { redirect: location.href } });
    return { session };
  },
  component: AppLayout,
});

function AppLayout() {
  const { user } = useAuth();
  const { session } = Route.useRouteContext();
  const u = user ?? session;
  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar role={u.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader user={u} />
        <main className={`${APP_CONTENT_SHELL} flex-1 animate-fade-up py-6 sm:py-8 lg:py-12`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
