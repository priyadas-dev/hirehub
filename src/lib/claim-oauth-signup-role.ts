import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isSupabaseServiceRoleConfigured } from "@/lib/oauth-signup-role";
import {
  CLAIM_OAUTH_RECRUITER_ROLE_RPC,
  evaluateClaimEligibility,
  isMissingRpcError,
  isRetryableClaimFailure,
  isValidDbPublicRole,
  mapClaimRpcStatus,
  userHasGoogleIdentity,
  withOneClaimRetry,
  type ClaimOAuthSignupRoleResult,
  type DbPublicRole,
} from "@/lib/oauth-signup-role-claim";

const requestSchema = z.object({
  requestedRole: z.enum(["job_seeker", "recruiter"]),
});

export type { ClaimOAuthSignupRoleResult };

/** Narrow admin surface used by claim helpers (real client or test double). */
export type ClaimAdminClient = {
  auth: {
    admin: {
      getUserById: (id: string) => Promise<{
        data: {
          user: {
            created_at?: string;
            identities?: { provider: string }[] | null;
            app_metadata?: { provider?: string; providers?: string[] } | null;
          } | null;
        };
        error: { message: string } | null;
      }>;
    };
  };
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{
          data: { id: string; role: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
    update: (payload: { role: string }) => {
      eq: (col: string, val: string) => {
        eq: (
          col2: string,
          val2: string,
        ) => PromiseLike<{ error: { message: string } | null }>;
      };
    };
  };
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

/**
 * Apply recruiter role via SQL RPC (preferred) or a single-row UPDATE.
 * Never delete+insert the profiles row (Phase 2 integrity fix).
 */
export async function applyOAuthRecruiterRoleUpdate(
  admin: ClaimAdminClient,
  userId: string,
  currentRole: DbPublicRole,
): Promise<ClaimOAuthSignupRoleResult> {
  const rpc = await admin.rpc(CLAIM_OAUTH_RECRUITER_ROLE_RPC, { p_user_id: userId });
  if (!rpc.error && typeof rpc.data === "string") {
    return mapClaimRpcStatus(rpc.data, currentRole);
  }
  if (rpc.error && !isMissingRpcError(rpc.error.message)) {
    const retryable = isRetryableClaimFailure(rpc.error.message);
    return {
      ok: false,
      message: rpc.error.message,
      retryable,
    };
  }

  // Fallback when PROPOSED_0019 is not applied yet — UPDATE only (needs PROPOSED_0007).
  const { error: updateError } = await admin
    .from("profiles")
    .update({ role: "recruiter" })
    .eq("id", userId)
    .eq("role", "job_seeker");

  if (updateError) {
    const blockedByRoleGuard = /only admins can change roles/i.test(updateError.message);
    return {
      ok: false,
      message: blockedByRoleGuard
        ? "Could not update your role (database role guard). Apply PROPOSED_0007 / PROPOSED_0019, then try Google signup again as Recruiter."
        : updateError.message,
      retryable: blockedByRoleGuard || isRetryableClaimFailure(updateError.message),
    };
  }

  const { data: verified, error: verifyError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (verifyError) {
    return { ok: false, message: verifyError.message, retryable: true };
  }
  if (verified?.role === "recruiter") {
    return { ok: true, applied: true, role: "recruiter" };
  }
  if (verified?.role && isValidDbPublicRole(verified.role) && verified.role !== "job_seeker") {
    return { ok: true, applied: false, role: verified.role };
  }
  return {
    ok: false,
    message: "Recruiter role update did not stick. Please try Continue with Google again.",
    retryable: true,
  };
}

/**
 * After Google OAuth, apply the UI-selected public signup role for brand-new
 * Google users only. Existing profiles keep their database role unchanged.
 * Never accepts `admin`. Never delete+insert profiles.
 *
 * Uses the service-role client (RPC or UPDATE). Requires PROPOSED_0007 so
 * protect_profile_role allows service-role updates when auth.uid() is null.
 */
export const claimOAuthSignupRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => requestSchema.parse(data))
  .handler(async ({ data, context }): Promise<ClaimOAuthSignupRoleResult> => {
    if (!isSupabaseServiceRoleConfigured()) {
      return {
        ok: false,
        message:
          "Server is missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_URL). Add them to the server .env (see .env.example), restart the app, then try Google signup again as Recruiter.",
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as ClaimAdminClient;

    return withOneClaimRetry(async () => {
      let userData: Awaited<ReturnType<typeof admin.auth.admin.getUserById>>["data"];
      try {
        const result = await admin.auth.admin.getUserById(context.userId);
        if (result.error || !result.data.user) {
          return { ok: false, message: "Could not verify your Google account.", retryable: true };
        }
        userData = result.data;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not verify your Google account.";
        return {
          ok: false,
          message:
            msg.includes("SUPABASE_SERVICE_ROLE_KEY") || msg.includes("SUPABASE_URL")
              ? "Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to your local .env (see .env.example), restart npm run dev, then try Google signup again as Recruiter."
              : msg,
          retryable: isRetryableClaimFailure(msg),
        };
      }

      const user = userData.user!;
      const hasGoogleIdentity = userHasGoogleIdentity(user);

      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("id,role")
        .eq("id", context.userId)
        .maybeSingle();

      if (profileError || !profile) {
        return {
          ok: false,
          message: "Your profile is not ready yet. Try signing in again.",
          retryable: true,
        };
      }

      if (!isValidDbPublicRole(profile.role)) {
        return { ok: false, message: "Your profile role is invalid." };
      }

      const currentRole = profile.role;
      const eligibility = evaluateClaimEligibility({
        requestedRole: data.requestedRole,
        currentRole,
        userCreatedAt: user.created_at,
        hasGoogleIdentity,
      });
      if (!eligibility.apply && eligibility.skip) {
        return eligibility.skip;
      }

      return applyOAuthRecruiterRoleUpdate(admin, context.userId, currentRole);
    });
  });
