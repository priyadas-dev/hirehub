/**
 * CRM AuthZ — ownership from database-backed recruiter_id / JWT role.
 * Never trust body-supplied userId/role.
 */
export function canAccessCrmOwnedResource(args: {
  ownerRecruiterId: string;
  callerId: string;
  callerRole: string | null | undefined;
}): boolean {
  if (!args.callerId || !args.ownerRecruiterId) return false;
  if (args.callerRole === "admin") return true;
  if (args.callerRole !== "recruiter" && args.callerRole !== "admin") return false;
  return args.callerId === args.ownerRecruiterId;
}

export function assertCanMutateCrm(args: {
  ownerRecruiterId: string;
  callerId: string;
  callerRole: string | null | undefined;
}): { ok: true } | { ok: false; error: string } {
  if (args.callerRole === "admin") return { ok: true };
  if (args.callerRole !== "recruiter") {
    return { ok: false, error: "Only recruiters or admins may manage CRM records" };
  }
  if (!canAccessCrmOwnedResource(args)) {
    return { ok: false, error: "Cannot access another recruiter's CRM records" };
  }
  return { ok: true };
}
