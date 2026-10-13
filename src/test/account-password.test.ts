import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  passwordStrengthIssue,
  resolvePasswordAuthMode,
  resetPasswordSchema,
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
      currentPassword: "old-password1",
      newPassword: "new-password1",
      confirmPassword: "different1",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects weak new passwords", () => {
    expect(passwordStrengthIssue("short")).toMatch(/8 characters/i);
    expect(passwordStrengthIssue("allletters")).toMatch(/number/i);
    expect(passwordStrengthIssue("goodpass1")).toBeNull();
  });

  it("rejects reusing the current password", () => {
    const parsed = changePasswordSchema.safeParse({
      currentPassword: "SamePass1",
      newPassword: "SamePass1",
      confirmPassword: "SamePass1",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts matching set passwords", () => {
    const parsed = setPasswordSchema.safeParse({
      newPassword: "new-password1",
      confirmPassword: "new-password1",
    });
    expect(parsed.success).toBe(true);
  });

  it("uses the same rules for reset password", () => {
    expect(
      resetPasswordSchema.safeParse({
        newPassword: "reset-pass1",
        confirmPassword: "reset-pass1",
      }).success,
    ).toBe(true);
  });
});
