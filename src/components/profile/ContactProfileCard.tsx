import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABEL, type Role } from "@/lib/auth";
import { ownProfileSchema, updateOwnProfile, type OwnProfileFields } from "@/lib/profile";

type ContactProfileCardProps = {
  userId: string;
  role: Role;
  email: string;
  fullName: string;
  phone: string | null;
  /** When true, show current role as read-only text (never editable). */
  showRole?: boolean;
  queryKey: unknown[];
  onSaved?: () => void | Promise<void>;
  initiallyEditing?: boolean;
};

export function ContactProfileCard({
  userId,
  role,
  email,
  fullName,
  phone,
  showRole = true,
  queryKey,
  onSaved,
  initiallyEditing = false,
}: ContactProfileCardProps) {
  const [editing, setEditing] = useState(initiallyEditing);
  const qc = useQueryClient();

  const form = useForm<OwnProfileFields>({
    resolver: zodResolver(ownProfileSchema),
    defaultValues: { full_name: fullName, phone: phone ?? "" },
  });

  useEffect(() => {
    form.reset({ full_name: fullName, phone: phone ?? "" });
  }, [fullName, phone, form]);

  const save = useMutation({
    mutationFn: (values: OwnProfileFields) => updateOwnProfile(userId, values),
    onSuccess: async () => {
      toast.success("Profile updated");
      setEditing(false);
      await qc.invalidateQueries({ queryKey });
      await onSaved?.();
    },
    onError: (e: Error) => toast.error("Could not update profile", { description: e.message }),
  });

  return (
    <section className="surface-card space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Contact information</h2>
          <p className="mt-1 text-sm text-muted-foreground">Your HireHub account details.</p>
        </div>
        {!editing && (
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit profile
          </Button>
        )}
      </div>

      {!editing ? (
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</dt>
            <dd className="mt-1 text-sm font-medium">{fullName || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</dt>
            <dd className="mt-1 break-all text-sm font-medium">{email || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Phone</dt>
            <dd className="mt-1 text-sm font-medium">{phone || "—"}</dd>
          </div>
          {showRole && (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Role</dt>
              <dd className="mt-1 text-sm font-medium">{ROLE_LABEL[role]}</dd>
            </div>
          )}
        </dl>
      ) : (
        <form
          className="max-w-xl space-y-4"
          onSubmit={form.handleSubmit((v) => save.mutate(v))}
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="contact-email">Account email</Label>
            <Input id="contact-email" value={email} disabled readOnly autoComplete="username" />
            <p className="text-xs text-muted-foreground">
              This is your Supabase Auth sign-in email. It cannot be edited from this form — changing it requires the
              Auth email-change confirmation flow in Supabase, not a HireHub profile field.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-full_name">Full name</Label>
            <Input id="contact-full_name" {...form.register("full_name")} autoComplete="name" />
            {form.formState.errors.full_name && (
              <p className="text-xs text-destructive">{form.formState.errors.full_name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-phone">Phone</Label>
            <Input id="contact-phone" {...form.register("phone")} inputMode="tel" placeholder="+880…" autoComplete="tel" />
            {form.formState.errors.phone && (
              <p className="text-xs text-destructive">{form.formState.errors.phone.message}</p>
            )}
          </div>
          {showRole && (
            <p className="text-xs text-muted-foreground">
              Your role is <span className="font-medium text-foreground">{ROLE_LABEL[role]}</span> and cannot be
              changed here.
              {role === "admin" ? " Admins manage other users’ roles from Manage Users." : ""}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="signal" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={() => {
                form.reset({ full_name: fullName, phone: phone ?? "" });
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
