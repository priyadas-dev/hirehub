import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "At least 8 characters").max(128),
    confirmPassword: z.string().min(8, "At least 8 characters").max(128),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export const setPasswordSchema = z
  .object({
    newPassword: z.string().min(8, "At least 8 characters").max(128),
    confirmPassword: z.string().min(8, "At least 8 characters").max(128),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

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

/** Sends a recovery email so the user can set/reset a password via /reset-password. */
export async function sendPasswordRecoveryEmail(email: string, redirectTo: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
  if (error) throw error;
}
