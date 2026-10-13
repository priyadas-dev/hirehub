import { createServerFn } from "@tanstack/react-start";
import {
  CONTACT_SERVER_ENV,
  contactMessageSchema,
  SUPPORT_EMAIL,
  type ContactMessageInput,
  type ContactSubmitResult,
} from "@/lib/contact";

/**
 * Contact form delivery via createServerFn (handler runs only on the server).
 *
 * Required env (never use VITE_ prefix — must not reach the browser):
 * - RESEND_API_KEY — Resend API key
 * - CONTACT_FROM_EMAIL — verified sender address on your Resend domain
 * Optional:
 * - CONTACT_TO_EMAIL — defaults to SUPPORT_EMAIL (priya.das@sjinnovation.com)
 *
 * Local: set in project `.env`, then restart `npm run dev`.
 * Vercel: Project Settings → Environment Variables as Secret (Production + Preview),
 * then Redeploy. Local `.env` does not configure Vercel or Lovable.
 */

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 5;
const recentByIp = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const prev = (recentByIp.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (prev.length >= RATE_MAX) {
    recentByIp.set(ip, prev);
    return true;
  }
  prev.push(now);
  recentByIp.set(ip, prev);
  return false;
}

async function resolveClientIp(): Promise<string> {
  const { getRequestHeader } = await import("@tanstack/react-start/server");
  const forwarded = getRequestHeader("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return getRequestHeader("cf-connecting-ip") ?? getRequestHeader("x-real-ip") ?? "unknown";
}

async function sendWithResend(input: {
  fullName: string;
  email: string;
  subject: string;
  message: string;
}): Promise<ContactSubmitResult> {
  const apiKey = process.env[CONTACT_SERVER_ENV.resendApiKey]?.trim();
  const from = process.env[CONTACT_SERVER_ENV.fromEmail]?.trim();
  const to = process.env[CONTACT_SERVER_ENV.toEmail]?.trim() || SUPPORT_EMAIL;

  if (!apiKey || !from) {
    // Log missing names only — never expose ops setup text to the browser.
    console.error("contact delivery not configured", {
      missing: [
        !apiKey ? CONTACT_SERVER_ENV.resendApiKey : null,
        !from ? CONTACT_SERVER_ENV.fromEmail : null,
      ].filter(Boolean),
    });
    return {
      ok: false,
      code: "provider_not_configured",
      message: "Automatic email sending is not available yet. Use the Gmail or email-app option to reach support.",
    };
  }

  const text = [
    `HireHub contact form`,
    ``,
    `From: ${input.fullName} <${input.email}>`,
    `Subject: ${input.subject}`,
    ``,
    input.message,
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: input.email,
      subject: `[HireHub] ${input.subject}`,
      text,
    }),
  });

  if (!res.ok) {
    // Do not log message body or API key material.
    console.error("contact delivery failed", { status: res.status });
    return {
      ok: false,
      code: "delivery_failed",
      message: "We couldn't send your message right now. Please try again in a few minutes.",
    };
  }

  return { ok: true, delivered: true };
}

export const submitContactMessage = createServerFn({ method: "POST" })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<ContactSubmitResult> => {
    const parsed = contactMessageSchema.safeParse(data);
    if (!parsed.success) {
      const fieldErrors: Partial<Record<keyof ContactMessageInput, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]) as keyof ContactMessageInput;
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return {
        ok: false,
        code: "validation",
        message: "Please fix the highlighted fields.",
        fieldErrors,
      };
    }

    if (parsed.data.companyWebsite) {
      return { ok: false, code: "spam", message: "Unable to submit this message." };
    }

    if (isRateLimited(await resolveClientIp())) {
      return {
        ok: false,
        code: "rate_limited",
        message: "Too many messages. Please wait a minute and try again.",
      };
    }

    try {
      return await sendWithResend({
        fullName: parsed.data.fullName,
        email: parsed.data.email,
        subject: parsed.data.subject,
        message: parsed.data.message,
      });
    } catch (err) {
      console.error("contact delivery error", err instanceof Error ? err.name : "unknown");
      return {
        ok: false,
        code: "delivery_failed",
        message: "We couldn't send your message right now. Please try again in a few minutes.",
      };
    }
  });
