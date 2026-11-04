import { classifyResendFailure } from "@/lib/resend-errors";
import { INTEGRATION_ENV, readIntegrationEnv, resolveResendFromEmail } from "@/lib/integrations/env";
import type { ApplicationStatus } from "@/components/status/status";

export function applicationStatusEmailIdempotencyKey(
  applicationId: string,
  status: ApplicationStatus,
): string {
  return `email:application_status:${applicationId}:${status}`;
}

export function buildApplicationStatusEmailPayload(input: {
  from: string;
  to: string;
  jobTitle: string;
  status: ApplicationStatus;
  applicationId: string;
}): {
  from: string;
  to: string[];
  subject: string;
  html: string;
  headers: Record<string, string>;
  tags: Array<{ name: string; value: string }>;
} {
  const title = input.jobTitle.trim() || "a job";
  return {
    from: input.from,
    to: [input.to],
    subject: `HireHub: application update — ${title}`,
    html: `<p>Your application for <strong>${escapeHtml(title)}</strong> is now <strong>${escapeHtml(input.status)}</strong>.</p><p>Sign in to HireHub to view details.</p>`,
    headers: {
      "X-HireHub-Application-Id": input.applicationId,
      "X-HireHub-Status": input.status,
    },
    tags: [
      { name: "hirehub_kind", value: "application_status" },
      { name: "application_id", value: input.applicationId },
    ],
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type SendApplicationStatusMailResult =
  | { ok: true; skipped: false; messageId: string; idempotencyKey: string }
  | { ok: true; skipped: true; reason: string; idempotencyKey: string }
  | { ok: false; reason: string; idempotencyKey: string };

const sentKeys = new Set<string>();

/** Test helper — clear process-local outbound idempotency. */
export function resetApplicationStatusMailIdempotencyForTests() {
  sentKeys.clear();
}

export async function sendApplicationStatusMail(input: {
  applicationId: string;
  status: ApplicationStatus;
  seekerEmail: string;
  jobTitle: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** When true, skip if key already sent in this process (and optional external check). */
  alreadySent?: (key: string) => boolean | Promise<boolean>;
}): Promise<SendApplicationStatusMailResult> {
  const env = input.env ?? process.env;
  const idempotencyKey = applicationStatusEmailIdempotencyKey(input.applicationId, input.status);

  if (sentKeys.has(idempotencyKey) || (await input.alreadySent?.(idempotencyKey))) {
    return { ok: true, skipped: true, reason: "already_sent", idempotencyKey };
  }

  const apiKey = readIntegrationEnv(INTEGRATION_ENV.resendApiKey, env);
  const from = resolveResendFromEmail(env);
  const to = input.seekerEmail.trim();
  if (!apiKey || !from) {
    return { ok: true, skipped: true, reason: "provider_not_configured", idempotencyKey };
  }
  if (!to || !to.includes("@")) {
    return { ok: true, skipped: true, reason: "missing_seeker_email", idempotencyKey };
  }

  const payload = buildApplicationStatusEmailPayload({
    from,
    to,
    jobTitle: input.jobTitle,
    status: input.status,
    applicationId: input.applicationId,
  });

  const fetchImpl = input.fetchImpl ?? fetch;
  const res = await fetchImpl("https://api.resend.com/emails", {
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
    return {
      ok: false,
      reason: `resend_${kind}`,
      idempotencyKey,
    };
  }

  const messageId =
    body && typeof body === "object" && "id" in body && typeof (body as { id: unknown }).id === "string"
      ? (body as { id: string }).id
      : "unknown";

  sentKeys.add(idempotencyKey);
  return { ok: true, skipped: false, messageId, idempotencyKey };
}
