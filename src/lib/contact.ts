import { z } from "zod";

/** Public support email shown on the marketing site (not a secret). */
export const SUPPORT_EMAIL = "priya.das@sjinnovation.com" as const;

/**
 * Display-only phone until country code is confirmed.
 * Do not attach a tel: link until the intended country/format is verified.
 */
export const SUPPORT_PHONE_DISPLAY = "01806085616" as const;

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
