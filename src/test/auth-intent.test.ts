import { describe, expect, it } from "vitest";
import { intentToSignupRole, parseAuthIntent, signupRoleToIntent } from "@/lib/auth-intent";

describe("auth intent", () => {
  it("accepts only seeker and recruiter", () => {
    expect(parseAuthIntent("seeker")).toBe("seeker");
    expect(parseAuthIntent("recruiter")).toBe("recruiter");
    expect(parseAuthIntent("admin")).toBeUndefined();
    expect(parseAuthIntent(undefined)).toBeUndefined();
  });

  it("maps intent to signup metadata roles only", () => {
    expect(intentToSignupRole("seeker")).toBe("job_seeker");
    expect(intentToSignupRole("recruiter")).toBe("recruiter");
  });

  it("maps signup roles back to marketing intents for OAuth redirectTo", () => {
    expect(signupRoleToIntent("job_seeker")).toBe("seeker");
    expect(signupRoleToIntent("recruiter")).toBe("recruiter");
  });
});
