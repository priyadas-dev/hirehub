import { z } from "zod";
import { isMissingSchemaError } from "@/lib/hirehub-storage";
import { supabase } from "@/integrations/supabase/client";

/** Matches PROPOSED_0009 `profiles_skills_length_check`. */
export const SKILLS_MAX_LENGTH = 2000 as const;

/** Shown when `profiles.skills` is not in the live schema yet. */
export const SKILLS_FEATURE_NOT_READY_MESSAGE =
  "Skills aren’t ready yet. This feature will unlock after the AI foundation database update." as const;

/** Fields a signed-in user may update on their own `profiles` row (never `role`). */
export const ownProfileSchema = z.object({
  full_name: z.string().trim().min(2, "Full name must be at least 2 characters"),
  email: z.string().trim().email("Enter a valid email address"),
  phone: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || v.length >= 7, "Enter a valid phone number"),
  skills: z
    .string()
    .trim()
    .max(SKILLS_MAX_LENGTH, `Skills must be at most ${SKILLS_MAX_LENGTH} characters`)
    .optional(),
});

export type OwnProfileFields = z.infer<typeof ownProfileSchema>;

export const resumeUrlSchema = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || /^https?:\/\/\S+/i.test(v), "Resume must be a full URL starting with http:// or https://");

/** Contact fields users may edit on their own profile — never includes `role`. */
export function buildOwnProfileUpdate(fields: OwnProfileFields, options?: { includeSkills?: boolean }) {
  const parsed = ownProfileSchema.parse(fields);
  const base = {
    full_name: parsed.full_name.trim(),
    email: parsed.email.trim().toLowerCase(),
    phone: parsed.phone?.trim() || null,
  };
  if (!options?.includeSkills) return base;
  return {
    ...base,
    skills: parsed.skills?.trim() ? parsed.skills.trim() : null,
  };
}

/**
 * Update the authenticated user's profile contact fields.
 * Always scopes by `auth.uid()` via the caller's id — never accepts a target user id from the UI.
 * Does not touch `role` (DB trigger `protect_profile_role` also blocks non-admin role changes).
 * Updates `profiles.email` (contact email recruiters see). Sign-in Auth email is unchanged here —
 * password / sign-in email changes belong on Settings.
 *
 * When `includeSkills` is true and the column is missing, contact fields still save and
 * `skillsUnavailable` is returned so the UI can show a friendly not-ready message.
 */
export async function updateOwnProfile(
  userId: string,
  fields: OwnProfileFields,
  options?: { includeSkills?: boolean },
) {
  const includeSkills = options?.includeSkills === true;
  const payload = buildOwnProfileUpdate(fields, { includeSkills });

  // `skills` is additive (PROPOSED_0009) and may be absent from generated Database types.
  const { data, error } = await supabase
    .from("profiles")
    .update(payload as never)
    .eq("id", userId)
    .select("id,full_name,email,phone,role")
    .maybeSingle();

  if (error && includeSkills && isMissingSchemaError(error.message)) {
    const withoutSkills = buildOwnProfileUpdate(fields, { includeSkills: false });
    const fallback = await supabase
      .from("profiles")
      .update(withoutSkills)
      .eq("id", userId)
      .select("id,full_name,email,phone,role")
      .maybeSingle();
    if (fallback.error) throw fallback.error;
    if (!fallback.data) throw new Error("Profile could not be saved.");
    return { ...fallback.data, skillsUnavailable: true as const };
  }

  if (error) throw error;
  if (!data) throw new Error("Profile could not be saved.");
  return { ...data, skillsUnavailable: false as const };
}

export async function fetchOwnProfile(userId: string) {
  const baseSelect = "id,full_name,email,phone,role,created_at" as const;

  // `skills` is additive (PROPOSED_0009) and may be absent from generated Database types / live schema.
  // Runtime select string still requests skills; cast keeps TypeScript aligned with current types.
  const withSkills = await supabase
    .from("profiles")
    .select("id,full_name,email,phone,role,created_at,skills" as typeof baseSelect)
    .eq("id", userId)
    .maybeSingle();

  if (withSkills.error && isMissingSchemaError(withSkills.error.message)) {
    const { data, error } = await supabase.from("profiles").select(baseSelect).eq("id", userId).maybeSingle();
    if (error) throw error;
    return data ? { ...data, skills: null as string | null, skillsAvailable: false as const } : null;
  }

  if (withSkills.error) throw withSkills.error;
  if (!withSkills.data) return null;

  const row = withSkills.data as typeof withSkills.data & { skills?: string | null };
  return {
    ...row,
    skills: typeof row.skills === "string" ? row.skills : null,
    skillsAvailable: true as const,
  };
}
