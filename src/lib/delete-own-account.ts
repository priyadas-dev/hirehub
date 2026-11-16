import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  STORAGE_CLEANUP_BLOCKED_MESSAGE,
  cleanupCompanyLogoStorage,
  cleanupUserResumeStorage,
  isStorageCleanupSuccessful,
  logStorageCleanupFailures,
  type AccountDeleteStorage,
} from "@/lib/delete-account-storage";
import { isSupabaseServiceRoleConfigured } from "@/lib/oauth-signup-role";

export type DeleteOwnAccountResult = { ok: true } | { ok: false; message: string };

/**
 * Seekers and recruiters may permanently delete their auth account so the same
 * email can sign up again and choose Job Seeker or Recruiter. Admins cannot.
 */
export function canDeleteOwnAccount(currentRole: string | null | undefined): boolean {
  return currentRole === "job_seeker" || currentRole === "recruiter";
}

/** Targets an admin may remove from Manage Users (not other admins, not self). */
export function canAdminDeleteTargetRole(targetRole: string | null | undefined): boolean {
  return canDeleteOwnAccount(targetRole);
}

const adminDeleteUserInputSchema = z.object({
  userId: z.string().uuid(),
});

export type DeleteAccountProfile = {
  id: string;
  role: string;
  resume_storage_path?: string | null;
};

export type DeleteAccountCompany = {
  id: string;
  logo_url?: string | null;
};

/** Narrow admin surface used by delete helpers (real client or test double). */
export type DeleteAccountAdminClient = {
  from: (table: string) => unknown;
  storage: AccountDeleteStorage;
  auth: {
    admin: {
      deleteUser: (id: string) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

type ProfilesTable = {
  select: (cols: string) => {
    eq: (
      col: string,
      val: string,
    ) => {
      maybeSingle: () => PromiseLike<{
        data: DeleteAccountProfile | null;
        error: { message: string } | null;
      }>;
    };
  };
};

type CompaniesTable = {
  select: (cols: string) => {
    eq: (
      col: string,
      val: string,
    ) => PromiseLike<{
      data: DeleteAccountCompany[] | null;
      error: { message: string } | null;
    }>;
  };
};

type JobRevisionsTable = {
  update: (payload: { reviewed_by: null }) => {
    eq: (col: string, val: string) => PromiseLike<{ error: { message: string } | null }>;
  };
};

/**
 * Shared delete pipeline after role authorization: null non-cascading FKs,
 * required Storage cleanup, then Auth delete (cascades HireHub rows).
 *
 * Auth delete runs only after owned Storage folders are confirmed empty.
 */
export async function performAccountDeletion(
  admin: DeleteAccountAdminClient,
  profile: DeleteAccountProfile,
): Promise<DeleteOwnAccountResult> {
  const userId = profile.id;

  // Non-cascading FK on job_revisions.reviewed_by (admins only in practice).
  try {
    const revisions = admin.from("job_revisions") as JobRevisionsTable;
    await revisions.update({ reviewed_by: null }).eq("reviewed_by", userId);
  } catch {
    /* table may be absent before migration; delete still proceeds */
  }

  let companyIds: string[] = [];
  if (profile.role === "recruiter") {
    try {
      const companies = admin.from("companies") as CompaniesTable;
      const companiesResult = await companies.select("id,logo_url").eq("recruiter_id", userId);
      if (companiesResult.error) {
        return {
          ok: false,
          message:
            companiesResult.error.message ||
            "Could not load company files for deletion. The account was not deleted.",
        };
      }
      companyIds = (companiesResult.data ?? []).map((c) => c.id).filter(Boolean);
    } catch (err) {
      console.error("[delete-account] company lookup failed", err);
      return {
        ok: false,
        message: "Could not load company files for deletion. The account was not deleted.",
      };
    }
  }

  try {
    const resumeCleanup = await cleanupUserResumeStorage(admin.storage, userId);
    logStorageCleanupFailures("resumes", resumeCleanup);
    if (!isStorageCleanupSuccessful(resumeCleanup)) {
      return { ok: false, message: STORAGE_CLEANUP_BLOCKED_MESSAGE };
    }

    if (profile.role === "recruiter" && companyIds.length > 0) {
      const logoCleanup = await cleanupCompanyLogoStorage(admin.storage, companyIds);
      logStorageCleanupFailures("company-logos", logoCleanup);
      if (!isStorageCleanupSuccessful(logoCleanup)) {
        return { ok: false, message: STORAGE_CLEANUP_BLOCKED_MESSAGE };
      }
    }
  } catch (err) {
    console.error("[delete-account] storage cleanup failed", err);
    return { ok: false, message: STORAGE_CLEANUP_BLOCKED_MESSAGE };
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    return {
      ok: false,
      message: deleteError.message || "Could not delete the account. Try again or contact support.",
    };
  }

  return { ok: true };
}

/**
 * Core self-delete: authorize seeker/recruiter, then shared deletion pipeline.
 * Exported for unit tests.
 */
export async function performDeleteOwnAccount(
  admin: DeleteAccountAdminClient,
  userId: string,
): Promise<DeleteOwnAccountResult> {
  const profiles = admin.from("profiles") as ProfilesTable;
  const { data: profile, error: profileError } = await profiles
    .select("id,role,resume_storage_path")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    return { ok: false, message: profileError.message };
  }
  if (!profile) {
    return { ok: false, message: "Your profile could not be found." };
  }

  if (!canDeleteOwnAccount(profile.role)) {
    return {
      ok: false,
      message:
        profile.role === "admin"
          ? "Admin accounts cannot be deleted from Settings. Contact support if you need help."
          : "Your profile role is invalid and cannot be deleted from Settings.",
    };
  }

  return performAccountDeletion(admin, profile);
}

/**
 * Admin Manage Users delete: caller must be admin; cannot delete self or other admins.
 */
export async function performAdminDeleteUser(
  admin: DeleteAccountAdminClient,
  input: {
    callerId: string;
    callerRole: string | null | undefined;
    targetUserId: string;
  },
): Promise<DeleteOwnAccountResult> {
  if (input.callerRole !== "admin") {
    return { ok: false, message: "Only admins can delete users from Manage Users." };
  }
  if (!input.targetUserId || input.targetUserId === input.callerId) {
    return { ok: false, message: "You cannot delete your own account from Manage Users." };
  }

  const profiles = admin.from("profiles") as ProfilesTable;
  const { data: profile, error: profileError } = await profiles
    .select("id,role,resume_storage_path")
    .eq("id", input.targetUserId)
    .maybeSingle();

  if (profileError) {
    return { ok: false, message: profileError.message };
  }
  if (!profile) {
    return { ok: false, message: "That user profile could not be found." };
  }

  if (profile.role === "admin") {
    return {
      ok: false,
      message: "Admin accounts cannot be deleted from Manage Users.",
    };
  }

  if (!canAdminDeleteTargetRole(profile.role)) {
    return {
      ok: false,
      message: "Only Job Seeker and Recruiter accounts can be deleted from Manage Users.",
    };
  }

  return performAccountDeletion(admin, profile);
}

/**
 * Permanently delete the signed-in user's auth account. Profiles and related
 * HireHub rows cascade from `auth.users`. After this, the same email can sign
 * up again and pick seeker or recruiter on `/auth`.
 */
export const deleteOwnAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DeleteOwnAccountResult> => {
    if (!isSupabaseServiceRoleConfigured()) {
      return {
        ok: false,
        message:
          "Server is missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_URL). Add them to the server .env, restart the app, then try again.",
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return performDeleteOwnAccount(supabaseAdmin as unknown as DeleteAccountAdminClient, context.userId);
  });

/**
 * Admin-only: permanently delete a seeker or recruiter from Manage Users.
 * Uses service-role Auth Admin API after Storage cleanup. Never deletes admins or self.
 */
export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => adminDeleteUserInputSchema.parse(data))
  .handler(async ({ data, context }): Promise<DeleteOwnAccountResult> => {
    if (!isSupabaseServiceRoleConfigured()) {
      return {
        ok: false,
        message:
          "Server is missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_URL). Add them to the server .env, restart the app, then try again.",
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as DeleteAccountAdminClient;
    const profiles = admin.from("profiles") as ProfilesTable;
    const { data: caller, error: callerError } = await profiles
      .select("id,role,resume_storage_path")
      .eq("id", context.userId)
      .maybeSingle();

    if (callerError) {
      return { ok: false, message: callerError.message };
    }

    return performAdminDeleteUser(admin, {
      callerId: context.userId,
      callerRole: caller?.role,
      targetUserId: data.userId,
    });
  });
