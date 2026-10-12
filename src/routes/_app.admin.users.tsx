import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { fmtDate, supabase } from "@/components/dashboard/parts";
import type { Database } from "@/integrations/supabase/types";

type UserRole = Database["public"]["Enums"]["user_role"];

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "job_seeker", label: "Job Seeker" },
  { value: "recruiter", label: "Recruiter" },
  { value: "admin", label: "Admin" },
];

const ROLE_LABEL: Record<UserRole, string> = {
  job_seeker: "Job Seeker",
  recruiter: "Recruiter",
  admin: "Admin",
};

export const Route = createFileRoute("/_app/admin/users")({
  head: () => ({
    meta: [
      { title: "Manage users — HireHub" },
      { name: "description", content: "View users and update their roles." },
    ],
  }),
  component: AdminUsersPage,
});

function AdminUsersPage() {
  const { user } = useAuth();
  const id = user?.id;
  const qc = useQueryClient();

  const users = useQuery({
    queryKey: ["admin-users", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name,email,role,phone,created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const updateRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: UserRole }) => {
      if (userId === id) throw new Error("You cannot change your own role.");
      const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Role updated");
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      await qc.invalidateQueries({ queryKey: ["admin-signups"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
      await qc.invalidateQueries({ queryKey: ["admin-reports"] });
    },
    onError: (e: Error) => toast.error("Could not update role", { description: e.message }),
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Manage users"
        description="Review everyone on the platform and update roles. Your own role cannot be changed here."
      />

      {users.isLoading ? (
        <CardSkeleton rows={5} />
      ) : users.isError ? (
        <ErrorState onRetry={() => void users.refetch()} />
      ) : users.data?.length ? (
        <div className="surface-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3 font-medium">User</th>
                <th className="px-5 py-3 font-medium">Joined</th>
                <th className="px-5 py-3 font-medium">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.data.map((p) => {
                const isSelf = p.id === id;
                return (
                  <tr key={p.id}>
                    <td className="px-5 py-3">
                      <p className="font-medium">{p.full_name || "Unnamed"}</p>
                      <p className="text-xs text-muted-foreground">{p.email}</p>
                      {isSelf && <p className="mt-0.5 text-xs text-signal">You</p>}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{fmtDate(p.created_at)}</td>
                    <td className="px-5 py-3">
                      {isSelf ? (
                        <span className="rounded-full border px-2.5 py-1 text-xs">{ROLE_LABEL[p.role]}</span>
                      ) : (
                        <Select
                          value={p.role}
                          disabled={updateRole.isPending}
                          onValueChange={(role) =>
                            updateRole.mutate({ userId: p.id, role: role as UserRole })
                          }
                        >
                          <SelectTrigger className="h-8 w-[150px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={Users} title="No users yet" description="Profiles will appear here as people sign up." />
      )}
    </div>
  );
}
