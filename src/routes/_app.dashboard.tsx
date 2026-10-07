import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Briefcase, FileText, Inbox, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { StatusTracker } from "@/components/status/StatusTracker";
import { StatusBadge } from "@/components/status/StatusBadge";
import { JOURNEY, type ApplicationStatus } from "@/components/status/status";
import { ROLE_LABEL, useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Overview — HireHub" },
      { name: "description", content: "Your HireHub workspace overview." },
      { property: "og:title", content: "Overview — HireHub" },
      { property: "og:description", content: "Your HireHub workspace overview." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<ApplicationStatus>("applied");
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 900);
    return () => clearTimeout(t);
  }, []);

  const first = user?.name.split(" ")[0] ?? "there";
  const isSeeker = user?.role === "seeker";

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow={user ? `${ROLE_LABEL[user.role]} workspace` : undefined}
        title={`Good to see you, ${first}.`}
        description="Here's where your hiring activity will come together."
      />

      <section aria-labelledby="stats" className="grid gap-4 sm:grid-cols-3">
        <h2 id="stats" className="sr-only">Summary</h2>
        {loading
          ? Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} rows={0} />)
          : [
              { label: isSeeker ? "Applications" : "Open roles", icon: isSeeker ? FileText : Briefcase },
              { label: isSeeker ? "Interviews" : "Candidates", icon: Inbox },
              { label: isSeeker ? "Offers" : "Hires", icon: Sparkles },
            ].map(({ label, icon: Icon }) => (
              <div key={label} className="surface-card interactive-card p-5">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  {label}
                  <Icon className="size-4" />
                </div>
                <p className="mt-3 font-display text-4xl">0</p>
              </div>
            ))}
      </section>

      <section aria-labelledby="journey" className="surface-card p-6 sm:p-8">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="journey" className="text-lg font-semibold">Application journey</h2>
            <p className="text-sm text-muted-foreground">A preview of how every application will be tracked.</p>
          </div>
          <StatusBadge status={status} />
        </div>
        <StatusTracker status={status} className="mx-auto max-w-2xl" />
        <div className="mt-8 flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Preview status">
          {[...JOURNEY, "rejected" as const].map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={status === s}
              onClick={() => {
                setStatus(s);
                if (s === "hired") toast.success("Hired! 🎉", { description: "This is how a candidate's big moment will feel." });
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-all",
                status === s ? "border-foreground bg-primary text-primary-foreground" : "bg-card hover:border-foreground/30",
              )}
            >
              {s === "rejected" ? "Not selected" : s}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-4 text-lg font-semibold">{isSeeker ? "Recent applications" : "Recent activity"}</h2>
          {loading ? (
            <CardSkeleton />
          ) : (
            <EmptyState
              icon={isSeeker ? FileText : Briefcase}
              title={isSeeker ? "No applications yet" : "Nothing here yet"}
              description={isSeeker ? "When you apply for a role, you'll follow its progress right here." : "Activity from your listings and candidates will appear here."}
              action={<Button variant="signal" onClick={() => toast("Coming soon", { description: "This area is being built next." })}>{isSeeker ? "Explore jobs" : "Post a job"}</Button>}
            />
          )}
        </div>
        <div>
          <h2 className="mb-4 text-lg font-semibold">Recommendations</h2>
          {loading ? <CardSkeleton /> : <ErrorState title="Recommendations unavailable" description="We couldn't load suggestions right now." onRetry={() => toast("Retrying…")} />}
        </div>
      </section>
    </div>
  );
}
