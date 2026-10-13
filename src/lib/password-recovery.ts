import { supabase } from "@/integrations/supabase/client";

export type RecoverySessionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Establish a recovery session from the current URL (hash tokens or PKCE ?code=).
 * Uses supported supabase-js auth APIs only.
 */
export async function establishPasswordRecoverySession(
  location: { hash: string; search: string } = typeof window !== "undefined"
    ? window.location
    : { hash: "", search: "" },
): Promise<RecoverySessionResult> {
  const { data: existing } = await supabase.auth.getSession();
  if (existing.session) return { ok: true };

  const search = new URLSearchParams(location.search.startsWith("?") ? location.search.slice(1) : location.search);
  const code = search.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return { ok: false, error: "This reset link is invalid or has expired. Request a new one." };
    }
    return { ok: true };
  }

  const hash = location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const type = params.get("type");
  if (accessToken && refreshToken && (type === "recovery" || type === null || type === "")) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      return { ok: false, error: "This reset link is invalid or has expired. Request a new one." };
    }
    return { ok: true };
  }

  return { ok: false, error: "Open the reset link from your email to choose a new password." };
}

/** Redirect target for resetPasswordForEmail — must be allowlisted in Supabase Auth. */
export function passwordResetRedirectUrl(origin: string = typeof window !== "undefined" ? window.location.origin : "") {
  return `${origin.replace(/\/+$/, "")}/reset-password`;
}
