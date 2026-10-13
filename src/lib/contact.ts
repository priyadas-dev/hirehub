import { z } from "zod";

/** Public support email shown on the marketing site (not a secret). */
export const SUPPORT_EMAIL = "priya.das@sjinnovation.com" as const;

/** Default mail client compose (To = support email). */
export const SUPPORT_MAILTO_HREF = `mailto:${SUPPORT_EMAIL}` as const;

/** Gmail web compose addressed to support (open in a new tab). */
export const SUPPORT_GMAIL_COMPOSE_HREF =
  `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(SUPPORT_EMAIL)}` as const;

/** Display number as provided by the project owner. */
export const SUPPORT_PHONE_DISPLAY = "01806085616" as const;

/** Bangladesh E.164 for dialer links (018… → +88018…). */
export const SUPPORT_PHONE_TEL = "+8801806085616" as const;

export const SUPPORT_TEL_HREF = `tel:${SUPPORT_PHONE_TEL}` as const;

/** Server-only contact delivery env names (never use VITE_ prefix). */
export const CONTACT_SERVER_ENV = {
  resendApiKey: "RESEND_API_KEY",
  fromEmail: "CONTACT_FROM_EMAIL",
  toEmail: "CONTACT_TO_EMAIL",
} as const;

export const contactMessageSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Enter your full name")
    .max(100, "Name is too long"),
  email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .max(255, "Email is too long"),
  subject: z
    .string()
    .trim()
    .min(3, "Enter a short subject")
    .max(120, "Subject is too long"),
  message: z
    .string()
    .trim()
    .min(10, "Tell us a bit more (at least 10 characters)")
    .max(2000, "Message is too long"),
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
