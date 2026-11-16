import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { CardSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/feedback/States";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { adminDeleteUser, canAdminDeleteTargetRole } from "@/lib/delete-own-account";
import { fmtDate, supabase } from "@/components/dashboard/parts";
import type { Database } from "@/integrations/supabase/types";

type UserRole = Database["public"]["Enums"]["user_role"];

type AdminUserRow = {
  id: string;
  full_name: string | null;
  email: string;
  role: UserRole;
  phone: string | null;
  created_at: string;
};

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
  const deleteUserFn = useServerFn(adminDeleteUser);
  const [pendingDelete, setPendingDelete] = useState<AdminUserRow | null>(null);

  const users = useQuery({
    queryKey: ["admin-users", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name,email,role,phone,created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AdminUserRow[];
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

  const deleteUser = useMutation({
    mutationFn: async (target: AdminUserRow) => {
      const result = await deleteUserFn({ data: { userId: target.id } });
      if (!result.ok) throw new Error(result.message);
      return target;
    },
    onSuccess: async (target) => {
      setPendingDelete(null);
      toast.success("User deleted", {
        description: `${target.full_name || target.email} was permanently removed.`,
      });
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      await qc.invalidateQueries({ queryKey: ["admin-signups"] });
      await qc.invalidateQueries({ queryKey: ["dash-counts"] });
      await qc.invalidateQueries({ queryKey: ["admin-reports"] });
    },
    onError: (e: Error) => toast.error("Could not delete user", { description: e.message }),
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Manage users"
        description="Review everyone on the platform and update roles. You can permanently delete Job Seeker and Recruiter accounts. Your own role cannot be changed here, and admin accounts cannot be deleted."
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
                <th className="px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.data.map((p) => {
                const isSelf = p.id === id;
                const canDelete = !isSelf && canAdminDeleteTargetRole(p.role);
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
                          disabled={updateRole.isPending || deleteUser.isPending}
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
                    <td className="px-5 py-3">
                      {canDelete ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={deleteUser.isPending}
                          onClick={() => setPendingDelete(p)}
                        >
                          <Trash2 className="size-3.5" />
                          Delete
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {isSelf ? "—" : p.role === "admin" ? "Protected" : "—"}
                        </span>
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

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open && !deleteUser.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this user permanently?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  This removes{" "}
                  <span className="font-medium text-foreground">
                    {pendingDelete?.full_name || pendingDelete?.email || "this user"}
                  </span>
                  {pendingDelete?.email ? ` (${pendingDelete.email})` : ""} and their workspace data.
                  They can sign up again later with the same email.
                </p>
                <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-destructive">
                  Applications, saved jobs, companies, job posts, and uploaded files cannot be recovered.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteUser.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteUser.isPending || !pendingDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (pendingDelete) deleteUser.mutate(pendingDelete);
              }}
            >
              {deleteUser.isPending ? (
                <>
                  <Loader2 className="animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete user"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
