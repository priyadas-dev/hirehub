import { describe, expect, it } from "vitest";
import { ownProfileSchema } from "@/lib/profile";

describe("ownProfileSchema", () => {
  it("requires a real name", () => {
    expect(ownProfileSchema.safeParse({ full_name: "A", phone: "" }).success).toBe(false);
    expect(ownProfileSchema.safeParse({ full_name: "Priya Das", phone: "01806085616" }).success).toBe(true);
  });

  it("allows empty phone but rejects short values", () => {
    expect(ownProfileSchema.safeParse({ full_name: "Priya Das", phone: "" }).success).toBe(true);
    expect(ownProfileSchema.safeParse({ full_name: "Priya Das", phone: "123" }).success).toBe(false);
  });
});
