import { describe, expect, it } from "vitest";
import {
  ADMIN_BOOTSTRAP_SQL,
  CONFIGURED_SUPABASE_PROJECT_REF,
  DEADLINE_MIGRATION_VERIFY_SQL,
  GOOGLE_OAUTH_REDIRECT_URLS,
  LIVE_DEMO_CHECKLIST,
  NEXT_WEEK_AI_AGENT_ROADMAP,
  NOTIFY_EDGE_FUNCTION_DECISION,
  OPTIONAL_AI_DECISION,
  PASSWORD_RESET_REDIRECT_URLS,
} from "@/lib/assignment-verification";

describe("assignment verification constants", () => {
  it("documents the configured Supabase project ref", () => {
    expect(CONFIGURED_SUPABASE_PROJECT_REF).toBe("munqgybiuqpncxbgfvdp");
  });

  it("separates 0002 column check from 0003 INSERT policy check", () => {
    expect(DEADLINE_MIGRATION_VERIFY_SQL.column0002).toMatch(/application_deadline/);
    expect(DEADLINE_MIGRATION_VERIFY_SQL.column0002).not.toMatch(/pg_policy/);
    expect(DEADLINE_MIGRATION_VERIFY_SQL.policy0003).toMatch(/seeker applies to approved job/);
    expect(DEADLINE_MIGRATION_VERIFY_SQL.policy0003).toMatch(/polwithcheck|with_check/i);
  });

  it("pauses notify expansion and AI until core demo is ready", () => {
    expect(NOTIFY_EDGE_FUNCTION_DECISION.assignmentMandatory).toBe(false);
    expect(NOTIFY_EDGE_FUNCTION_DECISION.expandNotifyFunctionsBeforeDemo).toBe(false);
    expect(NOTIFY_EDGE_FUNCTION_DECISION.deliveryStatus).toBe("delivered");
    expect(OPTIONAL_AI_DECISION.buildBeforeCoreDemoGreen).toBe(false);
    expect(OPTIONAL_AI_DECISION.preferredFirstFunction).toBe("ai-job-match");
  });

  it("records next-week AI-agent roadmap without implementing agents now", () => {
    expect(NEXT_WEEK_AI_AGENT_ROADMAP.map((s) => s.functionName)).toEqual([
      "ai-job-match",
      "ai-resume-assistant",
      "ai-match-agent",
    ]);
    expect(LIVE_DEMO_CHECKLIST.length).toBeGreaterThanOrEqual(5);
  });

  it("documents Google OAuth redirect URLs for localhost and Vercel", () => {
    expect(GOOGLE_OAUTH_REDIRECT_URLS.some((u) => u.includes("localhost:8080/auth"))).toBe(true);
    expect(GOOGLE_OAUTH_REDIRECT_URLS.some((u) => u.includes("localhost:8083/auth"))).toBe(true);
    expect(GOOGLE_OAUTH_REDIRECT_URLS.some((u) => u.includes("vercel.app/auth"))).toBe(true);
  });

  it("documents password reset redirect URLs for localhost and Vercel", () => {
    expect(PASSWORD_RESET_REDIRECT_URLS.some((u) => u.includes("localhost:8082/reset-password"))).toBe(true);
    expect(PASSWORD_RESET_REDIRECT_URLS.some((u) => u.includes("localhost:8083/reset-password"))).toBe(true);
    expect(PASSWORD_RESET_REDIRECT_URLS.some((u) => u.includes("vercel.app/reset-password"))).toBe(true);
    expect(LIVE_DEMO_CHECKLIST.some((c) => c.includes("Forgot password"))).toBe(true);
  });

  it("documents first-admin bootstrap SQL (signup never creates admins)", () => {
    expect(ADMIN_BOOTSTRAP_SQL).toMatch(/SET role = 'admin'/);
    expect(ADMIN_BOOTSTRAP_SQL).toMatch(/profiles_protect_role/);
  });
});



