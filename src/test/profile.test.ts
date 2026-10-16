import { describe, expect, it } from "vitest";
import {
  buildOwnProfileUpdate,
  ownProfileSchema,
  SKILLS_FEATURE_NOT_READY_MESSAGE,
  SKILLS_MAX_LENGTH,
} from "@/lib/profile";

describe("ownProfileSchema", () => {
  it("requires a real name and valid email", () => {
    expect(ownProfileSchema.safeParse({ full_name: "A", email: "a@b.co", phone: "" }).success).toBe(false);
    expect(
      ownProfileSchema.safeParse({ full_name: "Priya Das", email: "not-an-email", phone: "01806085616" }).success,
    ).toBe(false);
    expect(
      ownProfileSchema.safeParse({ full_name: "Priya Das", email: "priya@example.com", phone: "01806085616" }).success,
    ).toBe(true);
  });

  it("allows empty phone but rejects short values", () => {
    expect(ownProfileSchema.safeParse({ full_name: "Priya Das", email: "priya@example.com", phone: "" }).success).toBe(
      true,
    );
    expect(
      ownProfileSchema.safeParse({ full_name: "Priya Das", email: "priya@example.com", phone: "123" }).success,
    ).toBe(false);
  });

  it("allows optional skills within the length cap", () => {
    expect(
      ownProfileSchema.safeParse({
        full_name: "Priya Das",
        email: "priya@example.com",
        phone: "",
        skills: "TypeScript, React",
      }).success,
    ).toBe(true);
    expect(
      ownProfileSchema.safeParse({
        full_name: "Priya Das",
        email: "priya@example.com",
        phone: "",
        skills: "x".repeat(SKILLS_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("includes contact email but never role in own profile updates", () => {
    const payload = buildOwnProfileUpdate({
      full_name: "Priya Das",
      email: "Priya.Das@Example.com",
      phone: "01806085616",
    });
    expect(payload).toEqual({
      full_name: "Priya Das",
      email: "priya.das@example.com",
      phone: "01806085616",
    });
    expect(payload).not.toHaveProperty("role");
    expect(payload).not.toHaveProperty("skills");
  });

  it("includes skills only when explicitly requested and still omits role", () => {
    const payload = buildOwnProfileUpdate(
      {
        full_name: "Priya Das",
        email: "priya@example.com",
        phone: "",
        skills: "  SQL, Communication  ",
      },
      { includeSkills: true },
    );
    expect(payload).toEqual({
      full_name: "Priya Das",
      email: "priya@example.com",
      phone: null,
      skills: "SQL, Communication",
    });
    expect(payload).not.toHaveProperty("role");
    expect(SKILLS_FEATURE_NOT_READY_MESSAGE).toMatch(/not ready|aren’t ready|aren't ready/i);
  });
});
