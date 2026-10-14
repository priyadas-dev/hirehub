import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppSidebar } from "@/components/shell/AppSidebar";
import { AppHeader } from "@/components/shell/AppHeader";
import { ProfileSessionError, readSession, useAuth } from "@/lib/auth";
import { APP_CONTENT_SHELL } from "@/lib/shell-layout";

/** Path only. `location.search` is a parsed object, not a query string. */
function returnPath(location: { pathname: string; searchStr: string; hash: string }) {
  const hash = location.hash ? `#${location.hash}` : "";
  return `${location.pathname}${location.searchStr}${hash}`;
}

export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const returnTo = returnPath(location);
    let session;
    try {
      session = await readSession();
    } catch (err) {
      if (err instanceof ProfileSessionError) {
        throw redirect({ to: "/auth", search: { redirect: returnTo } });
      }
      throw err;
    }
    if (!session) throw redirect({ to: "/auth", search: { redirect: returnTo } });
    return { session };
  },
  component: AppLayout,
});

function AppLayout() {
  const { user } = useAuth();
  const { session } = Route.useRouteContext();
  const u = user ?? session;
  return (
    <div className="flex min-h-screen bg-surface/40">
      <AppSidebar role={u.role} />
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <AppHeader user={u} />
        <main className={`${APP_CONTENT_SHELL} flex-1 animate-fade-up py-6 sm:py-8 lg:py-12`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
