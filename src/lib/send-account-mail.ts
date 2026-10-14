import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { buildAccountEmail } from "@/lib/account-mail";
import { CONTACT_SERVER_ENV } from "@/lib/contact";
import { classifyResendFailure } from "@/lib/resend-errors";

const requestSchema = z.object({
  to: z.string().trim().email().max(255),
  kind: z.enum(["signup", "reset"]),
  origin: z.string().trim().url().max(200),
});

/**
 * Sends the account email through Resend (the provider that can actually deliver).
 * Supabase's built-in mailer is still called by the auth pages; this is the backup
 * that reaches the inbox when that mailer is rate-limited or not configured.
 */
export const sendAccountMail = createServerFn({ method: "POST" })
  .validator((data: unknown) => requestSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; message: string }> => {
    const apiKey = process.env[CONTACT_SERVER_ENV.resendApiKey]?.trim();
    const from = process.env[CONTACT_SERVER_ENV.fromEmail]?.trim();
    if (!apiKey || !from) {
      return { ok: false, message: "Account email is not configured on this server yet." };
    }

    const message = buildAccountEmail({ kind: data.kind, origin: data.origin });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [data.to],
        subject: message.subject,
        text: message.text,
      }),
    });

    if (!res.ok) {
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      const kind = classifyResendFailure(res.status, body);
      if (kind === "testing_recipient_restricted") {
        return {
          ok: false,
          message: "This email plan can only deliver to the HireHub inbox until a domain is verified.",
        };
      }
      return { ok: false, message: "The account email could not be sent. Try again in a few minutes." };
    }

    return { ok: true };
  });
