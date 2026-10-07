/**
 * Temporary client-side session for the UI foundation.
 * Swap the internals for Lovable Cloud auth later — keep this API stable.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Role = "seeker" | "recruiter" | "admin";
export interface SessionUser {
  name: string;
  email: string;
  role: Role;
}

export const ROLE_LABEL: Record<Role, string> = {
  seeker: "Job Seeker",
  recruiter: "Recruiter",
  admin: "Admin",
};

const KEY = "hirehub.session";

export function readSession(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

interface AuthCtx {
  user: SessionUser | null;
  signIn: (u: SessionUser) => void;
  signOut: () => void;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  useEffect(() => setUser(readSession()), []);
  const signIn = useCallback((u: SessionUser) => {
    window.localStorage.setItem(KEY, JSON.stringify(u));
    setUser(u);
  }, []);
  const signOut = useCallback(() => {
    window.localStorage.removeItem(KEY);
    setUser(null);
  }, []);
  return <Ctx.Provider value={{ user, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
