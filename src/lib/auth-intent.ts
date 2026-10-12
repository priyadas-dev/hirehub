/** Public signup intent from marketing links — not authorization (profiles.role is source of truth). */
export type AuthIntent = "seeker" | "recruiter";

export type SignupRole = "job_seeker" | "recruiter";

export function parseAuthIntent(value: unknown): AuthIntent | undefined {
  if (value === "seeker" || value === "recruiter") return value;
  return undefined;
}

export function intentToSignupRole(intent: AuthIntent): SignupRole {
  return intent === "recruiter" ? "recruiter" : "job_seeker";
}

export function signupRoleToIntent(role: SignupRole): AuthIntent {
  return role === "recruiter" ? "recruiter" : "seeker";
}

export const AUTH_INTENT_LABEL: Record<AuthIntent, string> = {
  seeker: "Job Seeker",
  recruiter: "Recruiter",
};
