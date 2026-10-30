import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  GOOGLE_OAUTH_SIGNIN_VALUE,
  isSupabaseServiceRoleConfigured,
  oauthIdentityFlags,
  shouldDiscardUnregisteredGoogleSignIn,
} from "@/lib/oauth-signup-role";

export type DiscardUnregisteredGoogleSignInResult =
  | { ok: true; discarded: boolean }
  | { ok: false; discarded: false; message: string };

/**
 * Remove an auth user Supabase created because Continue with Google was used
 * on Sign in by someone with no HireHub account.
 *
 * Refuses unless the account is a Google-only, default job_seeker profile
 * created in the last two minutes. Existing seekers, recruiters, admins, and
 * email-linked accounts are not deleted. Does not change roles.
 */
export const discardUnregisteredGoogleSignIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ confirmSignIn: z.literal(true) }).parse(data))
  .handler(async ({ context }): Promise<DiscardUnregisteredGoogleSignInResult> => {
    if (!isSupabaseServiceRoleConfigured()) {
      return {
        ok: false,
        discarded: false,
        message:
          "Server is missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_URL). Add them to the server .env, restart the app, then try again.",
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const userResult = await supabaseAdmin.auth.admin.getUserById(context.userId);
    if (userResult.error || !userResult.data.user) {
      return {
        ok: false,
        discarded: false,
        message: userResult.error?.message || "Could not verify this Google account.",
      };
    }

    const authUser = userResult.data.user;
    const flags = oauthIdentityFlags(authUser);

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", context.userId)
      .maybeSingle();

    if (profileError) {
      return { ok: false, discarded: false, message: profileError.message };
    }

    const eligible = shouldDiscardUnregisteredGoogleSignIn({
      oauth: GOOGLE_OAUTH_SIGNIN_VALUE,
      signInAttempt: true,
      hasSignupRole: false,
      userId: context.userId,
      createdAt: authUser.created_at,
      hasGoogleIdentity: flags.hasGoogleIdentity,
      hasEmailIdentity: flags.hasEmailIdentity,
      currentRole: profile?.role ?? null,
    });

    if (!eligible) {
      return { ok: true, discarded: false };
    }

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(context.userId);
    if (deleteError) {
      return {
        ok: false,
        discarded: false,
        message: deleteError.message || "Could not remove the automatic Google account.",
      };
    }

    return { ok: true, discarded: true };
  });
