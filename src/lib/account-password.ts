import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { authRedirectCandidates, isAuthRedirectError } from "@/lib/account-mail";

/** Shared strength rules for new passwords (never log or persist these values). */
export function passwordStrengthIssue(password: string): string | null {
  if (password.length < 8) return "At least 8 characters";
  if (password.length > 128) return "Password is too long";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Use letters and at least one number";
  }
  return null;
}

const newPasswordField = z
  .string()
  .min(8, "At least 8 characters")
  .max(128)
  .superRefine((value, ctx) => {
    const issue = passwordStrengthIssue(value);
    if (issue && issue !== "At least 8 characters") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
    }
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: newPasswordField,
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "New password must be different from the current password",
    path: ["newPassword"],
  });

export const setPasswordSchema = z
  .object({
    newPassword: newPasswordField,
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export const resetPasswordSchema = setPasswordSchema;

export type PasswordAuthMode = "change" | "set";

/** True when the user has an email/password identity (vs Google-only). */
export function resolvePasswordAuthMode(identities: { provider: string }[] | null | undefined): PasswordAuthMode {
  const providers = (identities ?? []).map((i) => i.provider);
  return providers.includes("email") ? "change" : "set";
}

/**
 * Change password for email/password accounts after verifying the current password.
 * Never logs or persists password values.
 */
export async function changePasswordWithCurrent(input: {
  email: string;
  currentPassword: string;
  newPassword: string;
}) {
  const email = input.email.trim();
  if (!email) throw new Error("Your account email is required to verify the current password.");

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email,
    password: input.currentPassword,
  });
  if (verifyError) {
    throw new Error("Current password is incorrect.");
  }

  const { error } = await supabase.auth.updateUser({ password: input.newPassword });
  if (error) throw error;
}

/**
 * Set a password for OAuth-only accounts that do not have an email identity yet.
 * Caller must already be signed in.
 */
export async function setPasswordForSignedInUser(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/**
 * Sends a recovery email. Tries the reset page, then the site origin, then the
 * Supabase Site URL, so a missing redirect allowlist entry does not block the mail.
 */
export async function sendPasswordRecoveryEmail(email: string, origin: string) {
  const trimmed = email.trim();
  let lastMessage = "Could not send the reset email.";
  for (const redirectTo of authRedirectCandidates(origin, "/reset-password")) {
    const { error } = await supabase.auth.resetPasswordForEmail(
      trimmed,
      redirectTo ? { redirectTo } : undefined,
    );
    if (!error) return;
    lastMessage = error.message;
    if (!isAuthRedirectError(error.message)) throw error;
  }
  throw new Error(lastMessage);
}

/** Creates the account, retrying without a custom redirect when that URL is not allowlisted. */
export async function signUpWithAccountEmail(input: {
  email: string;
  password: string;
  fullName: string;
  requestedRole: string;
  origin: string;
}) {
  const metadata = { full_name: input.fullName, requested_role: input.requestedRole };
  let last: Awaited<ReturnType<typeof supabase.auth.signUp>> | null = null;
  for (const emailRedirectTo of authRedirectCandidates(input.origin, "/auth")) {
    const result = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: emailRedirectTo ? { emailRedirectTo, data: metadata } : { data: metadata },
    });
    last = result;
    if (!result.error) return result;
    if (!isAuthRedirectError(result.error.message)) return result;
  }
  return last!;
}
