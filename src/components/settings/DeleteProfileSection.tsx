import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ROLE_LABEL, useAuth, type Role } from "@/lib/auth";
import { deleteOwnAccount } from "@/lib/delete-own-account";
import { clearRoleWelcomeSession } from "@/lib/role-welcome";

export function DeleteProfileSection({ currentRole }: { currentRole: Role }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deleteAccount = useServerFn(deleteOwnAccount);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await deleteAccount();
      if (!result.ok) throw new Error(result.message);
      return result;
    },
    onSuccess: async () => {
      clearRoleWelcomeSession();
      queryClient.clear();
      setConfirmOpen(false);
      await signOut();
      toast.success("Profile deleted", {
        description: "Sign up again with the same email and choose Job Seeker or Recruiter.",
      });
      await navigate({ to: "/auth", search: { mode: "signup" }, replace: true });
    },
    onError: (e: Error) => {
      toast.error("Could not delete profile", { description: e.message });
    },
  });

  if (currentRole === "admin") {
    return (
      <section className="surface-card max-w-xl space-y-3 border-destructive/20 p-5 sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight text-destructive">Delete profile</h2>
        <p className="text-sm text-muted-foreground">
          Admin accounts cannot be deleted from Settings.
        </p>
      </section>
    );
  }

  return (
    <section className="surface-card max-w-xl space-y-4 border-destructive/25 p-5 sm:p-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-destructive">Delete profile</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Permanently delete your {ROLE_LABEL[currentRole]} account. You can sign up again with the same
          email (including Google) and choose Job Seeker or Recruiter. Applications, saved jobs, company
          listings, job posts, and uploaded resumes or company logos tied to this account are removed and
          cannot be recovered.
        </p>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="destructive" disabled={mutation.isPending}>
            <Trash2 />
            Delete profile
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your HireHub profile?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  This permanently deletes your account and all workspace data. Afterward you can sign up
                  again with the same email and pick Job Seeker or Recruiter.
                </p>
                <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-destructive">
                  Applications, saved jobs, companies, job posts, and uploaded resumes or logos cannot be
                  recovered.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                mutation.mutate();
              }}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete profile"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
