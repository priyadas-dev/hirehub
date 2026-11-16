/**
 * Pure AuthZ helper for application-status notify / integration side effects.
 * Kept separate from notify-application-status to avoid circular imports with
 * createServerFn modules that must be browser-importable as RPC stubs.
 */

/** Caller may notify only when they own the job or are an admin. Role/ids from DB/JWT only. */
export function isAuthorizedApplicationNotifier(args: {
  callerId: string;
  callerRole: string | null | undefined;
  jobRecruiterId: string;
}): boolean {
  if (!args.callerId || !args.jobRecruiterId) return false;
  if (args.callerRole === "admin") return true;
  return args.callerId === args.jobRecruiterId;
}
