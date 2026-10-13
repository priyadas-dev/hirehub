import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  resolvePasswordAuthMode,
  setPasswordSchema,
} from "@/lib/account-password";

describe("account password helpers", () => {
  it("treats email identity as change mode", () => {
    expect(resolvePasswordAuthMode([{ provider: "email" }, { provider: "google" }])).toBe("change");
  });

  it("treats Google-only as set mode", () => {
    expect(resolvePasswordAuthMode([{ provider: "google" }])).toBe("set");
  });

  it("rejects mismatched change passwords", () => {
    const parsed = changePasswordSchema.safeParse({
      currentPassword: "old-password",
      newPassword: "new-password",
      confirmPassword: "different",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts matching set passwords", () => {
    const parsed = setPasswordSchema.safeParse({
      newPassword: "new-password",
      confirmPassword: "new-password",
    });
    expect(parsed.success).toBe(true);
  });
});
