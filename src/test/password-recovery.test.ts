import { describe, expect, it } from "vitest";
import { passwordResetRedirectUrl } from "@/lib/password-recovery";

describe("password recovery helpers", () => {
  it("builds /reset-password on the current origin", () => {
    expect(passwordResetRedirectUrl("https://hirehub.example")).toBe(
      "https://hirehub.example/reset-password",
    );
    expect(passwordResetRedirectUrl("http://localhost:8082/")).toBe(
      "http://localhost:8082/reset-password",
    );
  });
});
