import { describe, expect, it } from "vitest";
import { ProfileSessionError } from "@/lib/auth";
import { formatAuthErrorMessage, formatGoogleOAuthProviderError } from "@/lib/auth-errors";

describe("formatAuthErrorMessage", () => {
  it("keeps profile session errors verbatim", () => {
    expect(formatAuthErrorMessage(new ProfileSessionError("profile_missing", "No profile yet"))).toBe(
      "No profile yet",
    );
  });

  it("maps duplicate registration to sign-in guidance", () => {
    expect(formatAuthErrorMessage(new Error("User already registered"))).toMatch(/already exists/i);
    expect(formatAuthErrorMessage(new Error("User already registered"))).toMatch(/Sign in/i);
  });

  it("maps unconfirmed email to confirm-first copy", () => {
    expect(formatAuthErrorMessage(new Error("Email not confirmed"))).toMatch(/Confirm your email/i);
  });

  it("maps weak passwords to letters-and-number guidance", () => {
    expect(formatAuthErrorMessage(new Error("Password should contain at least one number"))).toMatch(
      /letters and a number/i,
    );
  });

  it("maps rate limits without mentioning local dashboard demos", () => {
    const msg = formatAuthErrorMessage({ message: "over_email_send_rate_limit", status: 429 });
    expect(msg).toMatch(/Too many/i);
    expect(msg).not.toMatch(/Supabase Auth/i);
  });

  it("maps invalid credentials with Google hint", () => {
    expect(formatAuthErrorMessage(new Error("Invalid login credentials"))).toMatch(/don't match/i);
    expect(formatAuthErrorMessage(new Error("Invalid login credentials"))).toMatch(/Google/i);
  });
});

describe("formatGoogleOAuthProviderError", () => {
  it("uses generic copy for token exchange failures without project refs", () => {
    const msg = formatGoogleOAuthProviderError(
      "server_error",
      "failed+to+exchange+authorization+code",
    );
    expect(msg).toMatch(/Google could not finish/i);
    expect(msg).not.toMatch(/munqgybiuqpncxbgfvdp/i);
    expect(msg).not.toMatch(/supabase\.co\/auth/i);
  });

  it("recognizes cancelled consent", () => {
    expect(formatGoogleOAuthProviderError("access_denied", "User cancelled")).toMatch(/cancelled/i);
  });
});
