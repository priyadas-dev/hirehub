import { Activity, Briefcase, Building2, FileText, ShieldCheck, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { CardSkeleton, EmptyState } from "@/components/feedback/States";
import { countRows, fmtDate, Section, StatCard, supabase, useCounts } from "./parts";
import { useAuth } from "@/lib/auth";

export function AdminDashboard() {
  const { user } = useAuth();
  const id = user?.id;
  const counts = useCounts("admin", id, async () => {
    const [pendingJobs, pendingCompanies, users, applications] = await Promise.all([
      countRows(() => supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "pending")),
      countRows(() => supabase.from("companies").select("id", { count: "exact", head: true }).eq("status", "pending")),
      countRows(() => supabase.from("profiles").select("id", { count: "exact", head: true })),
      countRows(() => supabase.from("applications").select("id", { count: "exact", head: true })),
    ]);
    return { pendingJobs, pendingCompanies, users, applications };
  });
  const attention = useQuery({
    queryKey: ["admin-attention", id], enabled: !!id,
    queryFn: async () => {
      const [j, co] = await Promise.all([
        supabase.from("jobs").select("id,title,created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(5),
        supabase.from("companies").select("id,name,created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(5),
      ]);
      if (j.error) throw j.error;
      if (co.error) throw co.error;
      return [
        ...j.data.map((x) => ({ id: x.id, kind: "Job" as const, name: x.title, at: x.created_at })),
        ...co.data.map((x) => ({ id: x.id, kind: "Company" as const, name: x.name, at: x.created_at })),
      ].sort((a, b) => b.at.localeCompare(a.at));
    },
  });
  const signups = useQuery({
    queryKey: ["admin-signups", id], enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id,full_name,email,role,created_at").order("created_at", { ascending: false }).limit(6);
      if (error) throw error;
      return data;
    },
  });
  const c = counts.data;
  const roleLabel = { job_seeker: "Job Seeker", recruiter: "Recruiter", admin: "Admin" } as const;

  return (
    <div className="space-y-10">
      <header className="rounded-2xl bg-primary p-6 text-primary-foreground sm:p-8">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] opacity-70">
          <ShieldCheck className="size-4" /> Admin control center
        </div>
        <h1 className="mt-2 font-display text-3xl sm:text-4xl">Platform overview</h1>
        <p className="mt-2 max-w-lg text-sm opacity-70">Review what needs approval and keep an eye on activity across HireHub.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pending jobs" value={c?.pendingJobs} icon={Briefcase} tone="interview" loading={counts.isLoading} />
        <StatCard label="Pending companies" value={c?.pendingCompanies} icon={Building2} tone="shortlisted" loading={counts.isLoading} />
        <StatCard label="Total users" value={c?.users} icon={Users} loading={counts.isLoading} />
        <StatCard label="Applications" value={c?.applications} icon={FileText} tone="applied" loading={counts.isLoading} />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Needs attention" description="Jobs and companies waiting for approval">
          {attention.isLoading ? <CardSkeleton /> : attention.data?.length ? (
            <div className="surface-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Item</th><th className="px-5 py-3 font-medium">Type</th><th className="px-5 py-3 font-medium">Submitted</th>
                </tr></thead>
                <tbody className="divide-y">
                  {attention.data.map((r) => (
                    <tr key={r.kind + r.id}>
                      <td className="px-5 py-3 font-medium">{r.name}</td>
                      <td className="px-5 py-3"><span className="rounded-full bg-status-interview-soft px-2 py-0.5 text-xs text-status-interview">{r.kind}</span></td>
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(r.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={ShieldCheck} title="All clear" description="Nothing is waiting for approval right now." />
          )}
        </Section>
        <Section title="Recent platform activity" description="Latest signups">
          {signups.isLoading ? <CardSkeleton /> : signups.data?.length ? (
            <ul className="surface-card divide-y">
              {signups.data.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.full_name || p.email}</p>
                    <p className="text-xs text-muted-foreground">Joined {fmtDate(p.created_at)}</p>
                  </div>
                  <span className="rounded-full border px-2.5 py-1 text-xs">{roleLabel[p.role]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Activity} title="No activity yet" description="New signups and platform events will appear here." />
          )}
        </Section>
      </div>
    </div>
  );
}
