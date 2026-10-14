import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useServerFn } from "@tanstack/react-start";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  changePasswordSchema,
  changePasswordWithCurrent,
  resolvePasswordAuthMode,
  sendPasswordRecoveryEmail,
  setPasswordForSignedInUser,
  setPasswordSchema,
  type PasswordAuthMode,
} from "@/lib/account-password";
import { sendAccountMail } from "@/lib/send-account-mail";
import { supabase } from "@/integrations/supabase/client";

type ChangeValues = z.infer<typeof changePasswordSchema>;
type SetValues = z.infer<typeof setPasswordSchema>;

export function ChangePasswordForm({ email }: { email: string }) {
  const [mode, setMode] = useState<PasswordAuthMode | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [inlineSuccess, setInlineSuccess] = useState<string | null>(null);
  const mailAccount = useServerFn(sendAccountMail);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (cancelled) return;
      if (error || !data.user) {
        setModeError("Could not load your account authentication methods.");
        return;
      }
      setMode(resolvePasswordAuthMode(data.user.identities));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const changeForm = useForm<ChangeValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const setForm = useForm<SetValues>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const change = useMutation({
    mutationFn: (values: ChangeValues) =>
      changePasswordWithCurrent({
        email,
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      }),
    onSuccess: () => {
      setInlineSuccess("Password updated successfully.");
      toast.success("Password updated");
      changeForm.reset();
      setFormOpen(false);
    },
    onError: (e: Error) => {
      setInlineSuccess(null);
      toast.error("Could not change password", { description: e.message });
    },
  });

  const setPassword = useMutation({
    mutationFn: (values: SetValues) => setPasswordForSignedInUser(values.newPassword),
    onSuccess: () => {
      setInlineSuccess("Password set. You can sign in with email and password as well as Google.");
      toast.success("Password set", {
        description: "You can now sign in with email and password as well as Google.",
      });
      setForm.reset();
      setMode("change");
      setFormOpen(false);
    },
    onError: (e: Error) => {
      setInlineSuccess(null);
      toast.error("Could not set password", { description: e.message });
    },
  });

  const recover = useMutation({
    mutationFn: async () => {
      const origin = window.location.origin;
      await sendPasswordRecoveryEmail(email, origin);
      await mailAccount({ data: { to: email, kind: "reset", origin } });
    },
    onSuccess: () => {
      setInlineSuccess(
        "If that email belongs to your account, a reset link is on the way. Open it on this HireHub site to continue.",
      );
      toast.success("Check your email", {
        description: "If an account exists for that address, a reset link is on the way.",
      });
    },
    onError: (e: Error) => {
      setInlineSuccess(null);
      toast.error("Could not send reset email", { description: e.message });
    },
  });

  if (modeError) {
    return <p className="text-sm text-destructive">{modeError}</p>;
  }

  if (!mode) {
    return <p className="text-sm text-muted-foreground">Checking how you sign in…</p>;
  }

  const openLabel = mode === "set" ? "Set password" : "Change password";

  if (!formOpen) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {mode === "set"
            ? "You signed in with Google and do not have an email password yet."
            : "Keep your account secure. The password form stays hidden until you choose to update it."}
        </p>
        {inlineSuccess && (
          <p role="status" className="rounded-lg border border-signal/30 bg-signal-soft/50 px-3 py-2 text-sm">
            {inlineSuccess}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="signal"
            onClick={() => {
              setInlineSuccess(null);
              setFormOpen(true);
            }}
          >
            {openLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={recover.isPending || !email}
            onClick={() => recover.mutate()}
          >
            {recover.isPending ? "Sending…" : "Forgot current password?"}
          </Button>
        </div>
      </div>
    );
  }

  if (mode === "set") {
    return (
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Set an email password here, or receive a reset link by email. Passwords are handled by Supabase Auth only.
        </p>
        <form className="space-y-4" onSubmit={setForm.handleSubmit((v) => setPassword.mutate(v))} noValidate>
          <div className="space-y-2">
            <Label htmlFor="set-new">New password</Label>
            <Input id="set-new" type="password" autoComplete="new-password" {...setForm.register("newPassword")} />
            {setForm.formState.errors.newPassword && (
              <p className="text-xs text-destructive">{setForm.formState.errors.newPassword.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="set-confirm">Confirm new password</Label>
            <Input
              id="set-confirm"
              type="password"
              autoComplete="new-password"
              {...setForm.register("confirmPassword")}
            />
            {setForm.formState.errors.confirmPassword && (
              <p className="text-xs text-destructive">{setForm.formState.errors.confirmPassword.message}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="signal" disabled={setPassword.isPending}>
              {setPassword.isPending ? "Saving…" : "Set password"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={recover.isPending || !email}
              onClick={() => recover.mutate()}
            >
              {recover.isPending ? "Sending…" : "Forgot current password?"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={setPassword.isPending}
              onClick={() => {
                setForm.reset();
                setFormOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={changeForm.handleSubmit((v) => change.mutate(v))} noValidate>
      <div className="space-y-2">
        <Label htmlFor="current-password">Current password</Label>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          {...changeForm.register("currentPassword")}
        />
        {changeForm.formState.errors.currentPassword && (
          <p className="text-xs text-destructive">{changeForm.formState.errors.currentPassword.message}</p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          {...changeForm.register("newPassword")}
        />
        {changeForm.formState.errors.newPassword && (
          <p className="text-xs text-destructive">{changeForm.formState.errors.newPassword.message}</p>
        )}
        <p className="text-xs text-muted-foreground">At least 8 characters with letters and a number.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          {...changeForm.register("confirmPassword")}
        />
        {changeForm.formState.errors.confirmPassword && (
          <p className="text-xs text-destructive">{changeForm.formState.errors.confirmPassword.message}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="signal" disabled={change.isPending}>
          {change.isPending ? "Updating…" : "Update password"}
        </Button>
        <Button type="button" variant="outline" disabled={recover.isPending || !email} onClick={() => recover.mutate()}>
          {recover.isPending ? "Sending…" : "Forgot current password?"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={change.isPending}
          onClick={() => {
            changeForm.reset();
            setFormOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
