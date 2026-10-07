/**
 * Lovable Cloud auth. Role always comes from `profiles.role` in the database,
 * never from anything picked in the browser.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Role = "seeker" | "recruiter" | "admin";
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export const ROLE_LABEL: Record<Role, string> = {
  seeker: "Job Seeker",
  recruiter: "Recruiter",
  admin: "Admin",
};

export const ROLE_HOME = { seeker: "/seeker", recruiter: "/recruiter", admin: "/admin" } as const;

const fromDb = (r: string | null | undefined): Role =>
  r === "recruiter" ? "recruiter" : r === "admin" ? "admin" : "seeker";

/** Reads the verified user and their stored profile role. */
export async function readSession(): Promise<SessionUser | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const u = data.user;
  const { data: p } = await supabase.from("profiles").select("full_name,email,role").eq("id", u.id).maybeSingle();
  const meta = u.user_metadata as Record<string, unknown>;
  const name = p?.full_name || (meta["full_name"] as string) || (meta["name"] as string) || (u.email ?? "Member").split("@")[0]!;
  return { id: u.id, name, email: p?.email ?? u.email ?? "", role: fromDb(p?.role) };
}

interface AuthCtx {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<SessionUser | null>;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const s = await readSession();
    setUser(s);
    setLoading(false);
    return s;
  }, []);
  useEffect(() => {
    void refresh();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") { setUser(null); return; }
      if (event === "SIGNED_IN" || event === "USER_UPDATED") setTimeout(() => void refresh(), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);
  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);
  return <Ctx.Provider value={{ user, loading, refresh, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
