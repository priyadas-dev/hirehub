import { createServerFn } from "@tanstack/react-start";
import {
  buildResendContactPayload,
  CONTACT_SERVER_ENV,
  contactMessageSchema,
  SUPPORT_EMAIL,
  type ContactMessageInput,
  type ContactSubmitResult,
} from "@/lib/contact";
import { classifyResendFailure, userMessageForResendFailure } from "@/lib/resend-errors";

/**
 * Public contact form delivery (no sign-in required).
 * Runs only on the server via createServerFn.
 *
 * Required env (never use VITE_ prefix — must not reach the browser):
 * - RESEND_API_KEY — Resend API key
 * - CONTACT_FROM_EMAIL — HireHub sender, e.g. HireHub <onboarding@resend.dev>
 * Optional:
 * - CONTACT_TO_EMAIL — inbox that receives enquiries (defaults to SUPPORT_EMAIL).
 *
 * Free Resend + onboarding@resend.dev: Resend only delivers to the Resend account
 * email. Arbitrary visitor→arbitrary inbox delivery needs a verified domain.
 *
 * Local: set in `.env`, restart `npm run dev`.
 * Hosted: set secrets in Vercel/Lovable and redeploy.
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
    console.error("contact delivery not configured", {
      missing: [
        !apiKey ? CONTACT_SERVER_ENV.resendApiKey : null,
        !from ? CONTACT_SERVER_ENV.fromEmail : null,
      ].filter(Boolean),
    });
    return {
      ok: false,
      code: "provider_not_configured",
      message: userMessageForResendFailure("provider_missing"),
    };
  }

  let payload;
  try {
    payload = buildResendContactPayload({
      from,
      to,
      visitorName: input.fullName,
      visitorEmail: input.email,
      subject: input.subject,
      message: input.message,
    });
  } catch {
    return {
      ok: false,
      code: "delivery_failed",
      message: userMessageForResendFailure("other"),
    };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const kind = classifyResendFailure(res.status, body);
    console.error("contact delivery failed", { status: res.status, kind });

    if (kind === "testing_recipient_restricted") {
      return {
        ok: false,
        code: "provider_not_configured",
        message: userMessageForResendFailure(kind),
      };
    }

    return {
      ok: false,
      code: "delivery_failed",
      message: userMessageForResendFailure(kind),
    };
  }

  // Only claim success when Resend confirms with an id.
  const deliveredId =
    typeof body === "object" && body && "id" in body && typeof (body as { id: unknown }).id === "string"
      ? (body as { id: string }).id
      : null;
  if (!deliveredId) {
    console.error("contact delivery failed", { status: res.status, kind: "missing_id" });
    return {
      ok: false,
      code: "delivery_failed",
      message: userMessageForResendFailure("other"),
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
        message: userMessageForResendFailure("other"),
      };
    }
  });
