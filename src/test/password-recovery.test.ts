import { describe, expect, it } from "vitest";
import { authRedirectCandidates, buildAccountEmail, recoveryRedirectTarget } from "@/lib/account-mail";
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

  it("moves a recovery hash off the homepage onto the reset page", () => {
    expect(
      recoveryRedirectTarget({
        pathname: "/",
        hash: "#access_token=abc&type=recovery",
        search: "",
        origin: "https://hirehub.example",
      }),
    ).toBe("https://hirehub.example/reset-password#access_token=abc&type=recovery");
    expect(
      recoveryRedirectTarget({
        pathname: "/reset-password",
        hash: "#type=recovery",
        search: "",
        origin: "https://hirehub.example",
      }),
    ).toBeNull();
  });

  it("tries the page, the origin, then the Supabase site URL", () => {
    expect(authRedirectCandidates("https://hirehub.example/", "/reset-password")).toEqual([
      "https://hirehub.example/reset-password",
      "https://hirehub.example",
      undefined,
    ]);
  });

  it("writes a reset email the inbox can open", () => {
    const mail = buildAccountEmail({ kind: "reset", origin: "https://hirehub.example" });
    expect(mail.subject).toMatch(/reset/i);
    expect(mail.text).toContain("https://hirehub.example/reset-password");
  });
});
