import { describe, expect, it } from "vitest";
import { buildOwnProfileUpdate, ownProfileSchema } from "@/lib/profile";

describe("ownProfileSchema", () => {
  it("requires a real name", () => {
    expect(ownProfileSchema.safeParse({ full_name: "A", phone: "" }).success).toBe(false);
    expect(ownProfileSchema.safeParse({ full_name: "Priya Das", phone: "01806085616" }).success).toBe(true);
  });

  it("allows empty phone but rejects short values", () => {
    expect(ownProfileSchema.safeParse({ full_name: "Priya Das", phone: "" }).success).toBe(true);
    expect(ownProfileSchema.safeParse({ full_name: "Priya Das", phone: "123" }).success).toBe(false);
  });

  it("never includes role or email in own profile updates", () => {
    const payload = buildOwnProfileUpdate({ full_name: "Priya Das", phone: "01806085616" });
    expect(payload).toEqual({ full_name: "Priya Das", phone: "01806085616" });
    expect(payload).not.toHaveProperty("role");
    expect(payload).not.toHaveProperty("email");
  });
});
