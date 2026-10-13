import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

/** Fields a signed-in user may update on their own `profiles` row (never `role`). */
export const ownProfileSchema = z.object({
  full_name: z.string().trim().min(2, "Full name must be at least 2 characters"),
  phone: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || v.length >= 7, "Enter a valid phone number"),
});

export type OwnProfileFields = z.infer<typeof ownProfileSchema>;

export const resumeUrlSchema = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || /^https?:\/\/\S+/i.test(v), "Resume must be a full URL starting with http:// or https://");

/** Contact fields users may edit on their own profile — never includes `role` or Auth email. */
export function buildOwnProfileUpdate(fields: OwnProfileFields) {
  const parsed = ownProfileSchema.parse(fields);
  return {
    full_name: parsed.full_name.trim(),
    phone: parsed.phone?.trim() || null,
  };
}

/**
 * Update the authenticated user's profile contact fields.
 * Always scopes by `auth.uid()` via the caller's id — never accepts a target user id from the UI.
 * Does not touch `role` (DB trigger `protect_profile_role` also blocks non-admin role changes).
 * Does not write Auth email into profiles — email changes must go through Supabase Auth.
 */
export async function updateOwnProfile(userId: string, fields: OwnProfileFields) {
  const { data, error } = await supabase
    .from("profiles")
    .update(buildOwnProfileUpdate(fields))
    .eq("id", userId)
    .select("id,full_name,email,phone,role")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Profile could not be saved.");
  return data;
}

export async function fetchOwnProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,email,phone,role,created_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
