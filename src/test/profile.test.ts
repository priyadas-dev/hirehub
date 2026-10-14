import { describe, expect, it } from "vitest";
import { buildOwnProfileUpdate, ownProfileSchema } from "@/lib/profile";

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
  });
});
