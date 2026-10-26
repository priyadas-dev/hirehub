import { z } from "zod";

/** Public support email shown on the marketing site (not a secret). */
export const SUPPORT_EMAIL = "priya.das@sjinnovation.com" as const;

/** Default mail client compose (To = support email). */
export const SUPPORT_MAILTO_HREF = `mailto:${SUPPORT_EMAIL}` as const;

/** Gmail web compose addressed to support (open in a new tab). */
export const SUPPORT_GMAIL_COMPOSE_HREF =
  `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(SUPPORT_EMAIL)}` as const;

/** Public placeholder support number (not a personal phone). */
export const SUPPORT_PHONE_DISPLAY = "+1 202-555-0100" as const;

/** E.164 for dialer links. */
export const SUPPORT_PHONE_TEL = "+12025550100" as const;

export const SUPPORT_TEL_HREF = `tel:${SUPPORT_PHONE_TEL}` as const;

/** Server-only contact delivery env names (never use a VITE_ prefix). */
export const CONTACT_SERVER_ENV = {
  resendApiKey: "RESEND_API_KEY",
  fromEmail: "CONTACT_FROM_EMAIL",
  toEmail: "CONTACT_TO_EMAIL",
} as const;

/** Safer single-line sanitizer used by the schema. */
export function sanitizeContactLine(value: string): string {
  return value
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** Multi-line message sanitizer — collapses excessive blank lines. */
export function sanitizeContactMessage(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const contactMessageSchema = z.object({
  fullName: z
    .string()
    .transform(sanitizeContactLine)
    .pipe(z.string().min(2, "Enter your full name").max(100, "Name is too long")),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address")
    .max(255, "Email is too long"),
  subject: z
    .string()
    .transform(sanitizeContactLine)
    .pipe(z.string().min(3, "Enter a short subject").max(120, "Subject is too long")),
  message: z
    .string()
    .transform(sanitizeContactMessage)
    .pipe(z.string().min(10, "Tell us a bit more (at least 10 characters)").max(2000, "Message is too long")),
  /** Honeypot — bots fill this; humans leave it empty. */
  companyWebsite: z.string().max(200).optional().default(""),
});

export type ContactMessageInput = z.infer<typeof contactMessageSchema>;

export type ContactSubmitResult =
  | { ok: true; delivered: true }
  | {
      ok: false;
      code: "validation" | "spam" | "rate_limited" | "provider_not_configured" | "delivery_failed";
      message: string;
      fieldErrors?: Partial<Record<keyof ContactMessageInput, string>>;
    };

export type ResendContactPayload = {
  from: string;
  to: string[];
  reply_to: string;
  subject: string;
  text: string;
};

/**
 * Build the Resend JSON body for a visitor contact submission.
 * - `from` is always the configured HireHub sender (never the visitor).
 * - `reply_to` is the visitor's validated email.
 * - `to` is CONTACT_TO_EMAIL (or SUPPORT_EMAIL default).
 */
export function buildResendContactPayload(input: {
  from: string;
  to: string;
  visitorName: string;
  visitorEmail: string;
  subject: string;
  message: string;
}): ResendContactPayload {
  const from = input.from.trim();
  const to = input.to.trim();
  const visitorEmail = input.visitorEmail.trim().toLowerCase();
  if (!from) throw new Error("Missing configured From address.");
  if (!to) throw new Error("Missing configured To address.");
  if (!visitorEmail) throw new Error("Missing visitor email.");
  // Hard rule: never use the visitor as From.
  if (from.toLowerCase().includes(visitorEmail)) {
    throw new Error("Visitor email must not be used as From.");
  }

  return {
    from,
    to: [to],
    reply_to: visitorEmail,
    subject: `[HireHub] ${input.subject}`,
    text: [
      "HireHub contact form",
      "",
      `From: ${input.visitorName} <${visitorEmail}>`,
      `Subject: ${input.subject}`,
      "",
      input.message,
    ].join("\n"),
  };
}

/** Prefill mailto to support when server email delivery is unavailable. */
export function buildContactMailtoDraft(input: {
  fullName: string;
  email: string;
  subject: string;
  message: string;
}): string {
  const body = [`From: ${input.fullName} <${input.email}>`, "", input.message].join("\n");
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`[HireHub] ${input.subject}`)}&body=${encodeURIComponent(body)}`;
}

/** Prefill Gmail compose to support when server email delivery is unavailable. */
export function buildContactGmailDraft(input: {
  fullName: string;
  email: string;
  subject: string;
  message: string;
}): string {
  const body = [`From: ${input.fullName} <${input.email}>`, "", input.message].join("\n");
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: SUPPORT_EMAIL,
    su: `[HireHub] ${input.subject}`,
    body,
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}
