/**
 * Lovable Cloud auth. Role always comes from `profiles.role` in the database,
 * never from anything picked in the browser.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { clearRoleWelcomeSession } from "@/lib/role-welcome";

export type Role = "seeker" | "recruiter" | "admin";
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export class ProfileSessionError extends Error {
  readonly code: "profile_missing" | "profile_role_invalid" | "profile_query_failed";
  constructor(code: ProfileSessionError["code"], message: string) {
    super(message);
    this.name = "ProfileSessionError";
    this.code = code;
  }
}

export const ROLE_LABEL: Record<Role, string> = {
  seeker: "Job Seeker",
  recruiter: "Recruiter",
  admin: "Admin",
};

export const ROLE_HOME = { seeker: "/seeker", recruiter: "/recruiter", admin: "/admin" } as const;

/**
 * Map DB `user_role` → app Role. Never invent a role for missing/unknown values
 * (that previously sent recruiters to the seeker workspace with the wrong toast).
 */
export function mapDbRole(r: string | null | undefined): Role | null {
  if (r === "job_seeker") return "seeker";
  if (r === "recruiter") return "recruiter";
  if (r === "admin") return "admin";
  return null;
}

/** Post-login toast copy from the verified profile role only. */
export function workspaceWelcomeDescription(role: Role): string {
  if (role === "admin") return "Opening your admin workspace.";
  if (role === "recruiter") return "Opening your recruiter workspace.";
  return "Opening your job seeker workspace.";
}

/**
 * Normalize auth `?redirect=` to a same-origin path (pathname + search + hash).
 * `_app` used to pass `location.href` (absolute URL); that must not bypass guards.
 */
export function normalizeAuthRedirect(redirect: string | undefined, origin?: string): string | undefined {
  if (!redirect) return undefined;
  if (redirect.startsWith("/") && !redirect.startsWith("//")) return redirect;
  try {
    const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const url = new URL(redirect, base);
    const expectedOrigin = origin ?? (typeof window !== "undefined" ? window.location.origin : url.origin);
    if (url.origin !== expectedOrigin) return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

/**
 * Honor `?redirect=` only when it targets that role's area (or shared settings).
 * Prevents a stale `/seeker` redirect from sending a recruiter to the wrong home.
 */
export function resolvePostAuthPath(role: Role, redirect: string | undefined, origin?: string): string {
  const home = ROLE_HOME[role];
  const normalized = normalizeAuthRedirect(redirect, origin);
  if (!normalized) return home;
  if (normalized.startsWith("//") || normalized.startsWith("/auth")) return home;
  const path = normalized.split(/[?#]/)[0] ?? "";
  if (path === "/settings") return "/settings";
  if (path === "/dashboard") return home;
  if (path === home || path.startsWith(`${home}/`)) return normalized;
  return home;
}

/** Reads the verified user and their stored profile role. */
export async function readSession(): Promise<SessionUser | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const u = data.user;
  const { data: p, error: profileError } = await supabase
    .from("profiles")
    .select("full_name,email,role")
    .eq("id", u.id)
    .maybeSingle();
  if (profileError) {
    throw new ProfileSessionError("profile_query_failed", profileError.message);
  }
  if (!p) {
    throw new ProfileSessionError(
      "profile_missing",
      "Your account has no profile yet. Sign out and try again, or contact support.",
    );
  }
  const role = mapDbRole(p.role);
  if (!role) {
    throw new ProfileSessionError(
      "profile_role_invalid",
      `Your profile role (${p.role ?? "empty"}) is invalid. Contact support — HireHub will not guess a workspace.`,
    );
  }
  const meta = u.user_metadata as Record<string, unknown>;
  const name =
    p.full_name ||
    (typeof meta["full_name"] === "string" ? meta["full_name"] : "") ||
    (typeof meta["name"] === "string" ? meta["name"] : "") ||
    (u.email ?? "Member").split("@")[0]!;
  return { id: u.id, name, email: p.email ?? u.email ?? "", role };
}

interface AuthCtx {
  user: SessionUser | null;
  loading: boolean;
  /** Set when auth succeeded but profiles.role could not be loaded safely. */
  profileError: string | null;
  refresh: () => Promise<SessionUser | null>;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    let s: SessionUser | null = null;
    try {
      s = await readSession();
      setProfileError(null);
    } catch (err) {
      if (err instanceof ProfileSessionError) {
        console.error("[auth] profile session error", err.code, err.message);
        setProfileError(err.message);
        setUser(null);
        setLoading(false);
        return null;
      }
      console.error("[auth] backend unavailable", err);
      setProfileError(null);
    }
    setUser(s);
    setLoading(false);
    return s;
  }, []);
  useEffect(() => {
    void refresh();
    try {
      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
          clearRoleWelcomeSession();
          setUser(null);
          setProfileError(null);
          return;
        }
        if (event === "SIGNED_IN" || event === "USER_UPDATED") setTimeout(() => void refresh(), 0);
      });
      return () => data.subscription.unsubscribe();
    } catch (err) {
      console.error("[auth] backend unavailable", err);
      return undefined;
    }
  }, [refresh]);
  const signOut = useCallback(async () => {
    clearRoleWelcomeSession();
    await supabase.auth.signOut();
    setUser(null);
    setProfileError(null);
  }, []);
  return <Ctx.Provider value={{ user, loading, profileError, refresh, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
