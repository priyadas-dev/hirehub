/** Classify Resend API error bodies for contact delivery (no secrets). */

export type ResendFailureKind =
  | "testing_recipient_restricted"
  | "unauthorized"
  | "provider_missing"
  | "other";

export function classifyResendFailure(status: number, body: unknown): ResendFailureKind {
  const message =
    typeof body === "object" && body && "message" in body && typeof (body as { message: unknown }).message === "string"
      ? (body as { message: string }).message.toLowerCase()
      : "";

  if (
    status === 403 &&
    (message.includes("only send testing emails to your own email") ||
      message.includes("verify a domain") ||
      message.includes("other recipients"))
  ) {
    return "testing_recipient_restricted";
  }

  if (status === 401 || status === 403) return "unauthorized";
  return "other";
}

/** Visitor-facing copy only — never mention API keys or env var names. */
export function userMessageForResendFailure(kind: ResendFailureKind): string {
  switch (kind) {
    case "provider_missing":
      return "Automatic email sending is not available yet. Use the Gmail or email-app option to reach support.";
    case "testing_recipient_restricted":
      return "Automatic email delivery is limited on the current email plan. Use the Gmail draft to finish sending your message to support.";
    case "unauthorized":
      return "We couldn't authenticate with the email provider. Please try again later, or use the Gmail draft option.";
    default:
      return "We couldn't send your message right now. Please try again in a few minutes, or use the Gmail draft option.";
  }
}
