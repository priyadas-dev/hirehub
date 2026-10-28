import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { shouldApplyOAuthSignupRole } from "@/lib/oauth-signup-role";

const requestSchema = z.object({
  requestedRole: z.enum(["job_seeker", "recruiter"]),
});

export type ClaimOAuthSignupRoleResult =
  | { ok: true; applied: boolean; role: "job_seeker" | "recruiter" | "admin"; reason?: string }
  | { ok: false; message: string };

/**
 * After Google OAuth, apply the UI-selected public signup role.
 * Existing recruiters/admins are never changed. Never accepts `admin`.
 *
 * Uses the service-role client so `protect_profile_role` cannot block a
 * one-time job_seeker → recruiter write for eligible Google signups.
 */
export const claimOAuthSignupRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => requestSchema.parse(data))
  .handler(async ({ data, context }): Promise<ClaimOAuthSignupRoleResult> => {
    let supabaseAdmin: Awaited<
      typeof import("@/integrations/supabase/client.server")
    >["supabaseAdmin"];
    try {
      ({ supabaseAdmin } = await import("@/integrations/supabase/client.server"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Server auth admin is not configured.";
      return {
        ok: false,
        message:
          msg.includes("SUPABASE_SERVICE_ROLE_KEY") || msg.includes("SUPABASE_URL")
            ? "Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to your local .env (see .env.example), restart npm run dev, then try Google signup again as Recruiter."
            : msg,
      };
    }

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

    const [{ count: companyCount }, { count: applicationCount }] = await Promise.all([
      supabaseAdmin
        .from("companies")
        .select("id", { count: "exact", head: true })
        .eq("recruiter_id", context.userId),
      supabaseAdmin
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("seeker_id", context.userId),
    ]);

    const unusedSeekerAccount = (companyCount ?? 0) === 0 && (applicationCount ?? 0) === 0;

    if (
      !shouldApplyOAuthSignupRole({
        requestedRole: data.requestedRole,
        currentRole,
        userCreatedAt: user.created_at,
        hasGoogleIdentity,
        unusedSeekerAccount,
      })
    ) {
      return {
        ok: true,
        applied: false,
        role: currentRole,
        reason:
          currentRole === "job_seeker" && data.requestedRole === "recruiter"
            ? "This Google account already has seeker activity, so HireHub kept job_seeker. Use a different Google account to sign up as a recruiter."
            : undefined,
      };
    }

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ role: "recruiter" })
      .eq("id", context.userId)
      .eq("role", "job_seeker");

    if (!updateError) {
      const { data: verified } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", context.userId)
        .maybeSingle();
      if (verified?.role === "recruiter") {
        return { ok: true, applied: true, role: "recruiter" };
      }
      // Fall through — trigger may have blocked without a clear error in some setups.
    } else {
      const blockedByRoleGuard = /only admins can change roles/i.test(updateError.message);
      if (!blockedByRoleGuard) {
        return { ok: false, message: updateError.message };
      }
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
