import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { shouldApplyOAuthSignupRole } from "@/lib/oauth-signup-role";

const requestSchema = z.object({
  requestedRole: z.enum(["job_seeker", "recruiter"]),
});

export type ClaimOAuthSignupRoleResult =
  | { ok: true; applied: boolean; role: "job_seeker" | "recruiter" | "admin" }
  | { ok: false; message: string };

/**
 * After Google OAuth, apply the UI-selected public signup role for brand-new
 * Google users only. Existing profiles keep their database role unchanged.
 *
 * Uses the service-role client so `protect_profile_role` cannot block a
 * one-time job_seeker → recruiter write (same privilege boundary as other
 * trusted server ops). Never accepts `admin`.
 */
export const claimOAuthSignupRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => requestSchema.parse(data))
  .handler(async ({ data, context }): Promise<ClaimOAuthSignupRoleResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(
      context.userId,
    );
    if (userError || !userData.user) {
      return { ok: false, message: "Could not verify your Google account." };
    }

    const user = userData.user;
    const hasGoogleIdentity = (user.identities ?? []).some((i) => i.provider === "google");

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id,email,full_name,phone,resume_file_name,resume_storage_path,role,created_at")
      .eq("id", context.userId)
      .maybeSingle();

    if (profileError || !profile) {
      return { ok: false, message: "Your profile is not ready yet. Try signing in again." };
    }

    const currentRole = profile.role;
    if (currentRole !== "job_seeker" && currentRole !== "recruiter" && currentRole !== "admin") {
      return { ok: false, message: "Your profile role is invalid." };
    }

    if (
      !shouldApplyOAuthSignupRole({
        requestedRole: data.requestedRole,
        currentRole,
        userCreatedAt: user.created_at,
        hasGoogleIdentity,
      })
    ) {
      return { ok: true, applied: false, role: currentRole };
    }

    // Prefer UPDATE. If protect_profile_role still blocks non-admin changes when
    // auth.uid() is null (pre-0007), fall back to delete+insert (INSERT is not
    // guarded by that trigger).
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ role: "recruiter" })
      .eq("id", context.userId)
      .eq("role", "job_seeker");

    if (!updateError) {
      return { ok: true, applied: true, role: "recruiter" };
    }

    const blockedByRoleGuard = /only admins can change roles/i.test(updateError.message);
    if (!blockedByRoleGuard) {
      return { ok: false, message: updateError.message };
    }

    const { error: deleteError } = await supabaseAdmin
      .from("profiles")
      .delete()
      .eq("id", context.userId);
    if (deleteError) {
      return { ok: false, message: deleteError.message };
    }

    const { error: insertError } = await supabaseAdmin.from("profiles").insert({
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
      phone: profile.phone,
      resume_file_name: profile.resume_file_name,
      resume_storage_path: profile.resume_storage_path,
      role: "recruiter",
      created_at: profile.created_at,
    });
    if (insertError) {
      // Best-effort restore as job_seeker so the account is not left without a profile.
      await supabaseAdmin.from("profiles").insert({
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        phone: profile.phone,
        resume_file_name: profile.resume_file_name,
        resume_storage_path: profile.resume_storage_path,
        role: "job_seeker",
        created_at: profile.created_at,
      });
      return { ok: false, message: insertError.message };
    }

    return { ok: true, applied: true, role: "recruiter" };
  });
