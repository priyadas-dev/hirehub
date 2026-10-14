/**
 * Recovery links sometimes land on the site root because only that URL is allowlisted.
 * Move the hash to /reset-password before the auth client consumes it.
 */
export function recoveryRedirectTarget(input: {
  pathname: string;
  hash: string;
  search: string;
  origin: string;
}): string | null {
  if (!input.hash.includes("type=recovery")) return null;
  if (input.pathname === "/reset-password") return null;
  const origin = input.origin.replace(/\/+$/, "");
  const search = input.search && input.search !== "?" ? input.search : "";
  return `${origin}/reset-password${search}${input.hash}`;
}

/** True when Supabase refused to send because redirectTo is not allowlisted. */
export function isAuthRedirectError(message: string): boolean {
  return /redirect/i.test(message);
}

/** Fallbacks: exact page, site origin, then Supabase Site URL (no redirectTo). */
export function authRedirectCandidates(origin: string, path: "/auth" | "/reset-password"): Array<string | undefined> {
  const base = origin.replace(/\/+$/, "");
  return [`${base}${path}`, base, undefined];
}

export function buildAccountEmail(input: { kind: "signup" | "reset"; origin: string }): {
  subject: string;
  text: string;
} {
  const origin = input.origin.replace(/\/+$/, "");
  if (input.kind === "reset") {
    return {
      subject: "Reset your HireHub password",
      text: [
        "HireHub received a request to reset the password for this account.",
        "",
        "Open the reset link in your inbox, then choose a new password at:",
        `${origin}/reset-password`,
        "",
        "If you did not ask for this, you can ignore this email.",
      ].join("\n"),
    };
  }
  return {
    subject: "Confirm your HireHub account",
    text: [
      "Your HireHub account is ready to confirm.",
      "",
      "Open the confirmation link in this inbox, then sign in:",
      `${origin}/auth`,
      "",
      "If you do not see it, check spam or use Continue with Google on the sign-in page.",
    ].join("\n"),
  };
}
