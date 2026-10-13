/** Session-scoped dashboard welcome overlay (recruiter + seeker). */

export type WelcomeRole = "recruiter" | "seeker";

export const ROLE_WELCOME_STORAGE_KEY = "hirehub.roleWelcome.shown";

/** Visible duration before farewell (~3–4s total with enter/exit). */
export const ROLE_WELCOME_HOLD_MS = 3400;
export const ROLE_WELCOME_FAREWELL_MS = 750;
export const ROLE_WELCOME_EXIT_MS = 480;
/** Shorter timeline when the user prefers reduced motion. */
export const ROLE_WELCOME_REDUCED_HOLD_MS = 2000;

/**
 * Survives React Strict Mode's mount→unmount→remount so auto-dismiss timers
 * can be restarted after sessionStorage was already marked on the first mount.
 */
const pendingWelcomeRemount = new Set<string>();

export function firstNameFromFullName(fullName: string): string {
  const part = fullName.trim().split(/\s+/)[0];
  return part || "there";
}

export function welcomeSubtitleForRole(role: WelcomeRole): string {
  return role === "recruiter" ? "Ready to find great talent?" : "Ready to find your next role?";
}

/** Admins and other roles never get this overlay. */
export function canShowRoleWelcome(role: string | null | undefined): role is WelcomeRole {
  return role === "recruiter" || role === "seeker";
}

export function shouldShowRoleWelcome(userId: string): boolean {
  if (typeof sessionStorage === "undefined") return true;
  try {
    return sessionStorage.getItem(ROLE_WELCOME_STORAGE_KEY) !== userId;
  } catch {
    return true;
  }
}

export function markRoleWelcomeShown(userId: string): void {
  try {
    sessionStorage.setItem(ROLE_WELCOME_STORAGE_KEY, userId);
  } catch {
    /* private / blocked storage */
  }
}

/**
 * Decide whether RoleWelcome should run its enter→dismiss timeline.
 * Handles Strict Mode: cleanup flags a pending remount so the second mount
 * can restart timers even though sessionStorage was already marked.
 */
export function claimRoleWelcomePresentation(userId: string, forceShow = false): boolean {
  if (forceShow) {
    pendingWelcomeRemount.delete(userId);
    return true;
  }
  if (shouldShowRoleWelcome(userId)) {
    markRoleWelcomeShown(userId);
    pendingWelcomeRemount.delete(userId);
    return true;
  }
  if (pendingWelcomeRemount.has(userId)) {
    pendingWelcomeRemount.delete(userId);
    return true;
  }
  return false;
}

/** Call from effect cleanup so a synchronous Strict Mode remount can reclaim. */
export function noteRoleWelcomeEffectCleanup(userId: string): void {
  pendingWelcomeRemount.add(userId);
  if (typeof queueMicrotask === "function") {
    queueMicrotask(() => {
      pendingWelcomeRemount.delete(userId);
    });
  } else {
    setTimeout(() => pendingWelcomeRemount.delete(userId), 0);
  }
}

/** Call on sign-out so the next login in this tab can welcome again. */
export function clearRoleWelcomeSession(): void {
  pendingWelcomeRemount.clear();
  try {
    sessionStorage.removeItem(ROLE_WELCOME_STORAGE_KEY);
    // Clear legacy key from the recruiter-only welcome.
    sessionStorage.removeItem("hirehub.recruiterWelcome.shown");
  } catch {
    /* private / blocked storage */
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
