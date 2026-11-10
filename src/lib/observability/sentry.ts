/**
 * Track 6 — optional Sentry observability.
 * Activates only when a DSN is present. Never throws; never logs secrets.
 *
 * Server: set `SENTRY_DSN` in host secrets (Vercel / local .env — do not commit).
 * Browser: optional public `VITE_SENTRY_DSN` (DSN is designed to be public; still not a secret token).
 */

import { describeError } from "@/lib/error-capture";

type SentryLike = {
  captureException: (error: unknown, hint?: { tags?: Record<string, string> }) => void;
  captureMessage?: (message: string, level?: "error" | "warning" | "info") => void;
};

let serverClient: SentryLike | null | undefined;
let browserClient: SentryLike | null | undefined;
let serverInitStarted = false;
let browserInitStarted = false;

function readServerDsn(): string {
  return (typeof process !== "undefined" ? process.env.SENTRY_DSN : undefined)?.trim() || "";
}

function readBrowserDsn(): string {
  try {
    const viteDsn = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.[
      "VITE_SENTRY_DSN"
    ];
    return viteDsn?.trim() || "";
  } catch {
    return "";
  }
}

function scrubMessage(raw: string): string {
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]")
    .replace(/(api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?[^"'\s]+/gi, "$1=[redacted]")
    .slice(0, 4000);
}

/** Idempotent server init. Safe to call from server entry / error paths. */
export async function initServerSentry(): Promise<boolean> {
  if (serverInitStarted) return Boolean(serverClient);
  serverInitStarted = true;
  const dsn = readServerDsn();
  if (!dsn) {
    serverClient = null;
    return false;
  }
  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn,
      tracesSampleRate: 0,
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.message) event.message = scrubMessage(event.message);
        if (event.exception?.values) {
          for (const value of event.exception.values) {
            if (value.value) value.value = scrubMessage(value.value);
          }
        }
        return event;
      },
    });
    serverClient = Sentry;
    return true;
  } catch {
    serverClient = null;
    return false;
  }
}

/** Idempotent browser init. Safe no-op without VITE_SENTRY_DSN. */
export async function initBrowserSentry(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (browserInitStarted) return Boolean(browserClient);
  browserInitStarted = true;
  const dsn = readBrowserDsn();
  if (!dsn) {
    browserClient = null;
    return false;
  }
  try {
    const Sentry = await import("@sentry/react");
    Sentry.init({
      dsn,
      tracesSampleRate: 0,
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.message) event.message = scrubMessage(event.message);
        return event;
      },
    });
    browserClient = Sentry;
    return true;
  } catch {
    browserClient = null;
    return false;
  }
}

export function captureException(
  error: unknown,
  tags: Record<string, string> = {},
): void {
  const client = typeof window === "undefined" ? serverClient : browserClient;
  if (!client) {
    // Fire-and-forget init + retry once for late DSN wiring on server.
    if (typeof window === "undefined" && !serverInitStarted) {
      void initServerSentry().then((ok) => {
        if (ok && serverClient) {
          serverClient.captureException(error, { tags });
        }
      });
    }
    return;
  }
  try {
    client.captureException(error, { tags });
  } catch {
    // Never break the app for telemetry.
  }
}

export function captureDescribedError(
  error: unknown,
  tags: Record<string, string> = {},
): void {
  if (error instanceof Error) {
    captureException(error, tags);
    return;
  }
  const message = scrubMessage(describeError(error));
  captureException(new Error(message), tags);
}

export function isServerSentryConfigured(): boolean {
  return Boolean(readServerDsn());
}

export function isBrowserSentryConfigured(): boolean {
  return Boolean(readBrowserDsn());
}
