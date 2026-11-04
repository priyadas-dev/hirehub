/**
 * Verify Resend inbound webhooks (Svix signing).
 * Spec: https://docs.svix.com/receiving/verifying-payloads/how
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SVIX_TOLERANCE_SEC = 300;

export type SvixHeaders = {
  id: string;
  timestamp: string;
  signature: string;
};

export function parseSvixHeaders(headers: Headers | Record<string, string | null | undefined>): SvixHeaders | null {
  const get = (name: string) => {
    if (headers instanceof Headers) return headers.get(name) ?? headers.get(name.toLowerCase());
    const direct = headers[name] ?? headers[name.toLowerCase()];
    return direct ?? null;
  };
  const id = get("svix-id")?.trim() || "";
  const timestamp = get("svix-timestamp")?.trim() || "";
  const signature = get("svix-signature")?.trim() || "";
  if (!id || !timestamp || !signature) return null;
  return { id, timestamp, signature };
}

function decodeWebhookSecret(secret: string): Buffer {
  const raw = secret.trim();
  const withoutPrefix = raw.startsWith("whsec_") ? raw.slice("whsec_".length) : raw;
  return Buffer.from(withoutPrefix, "base64");
}

function safeEqualB64(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * @returns true when at least one `v1` signature matches.
 */
export function verifySvixSignature(input: {
  secret: string;
  headers: SvixHeaders;
  body: string;
  nowSec?: number;
  toleranceSec?: number;
}): boolean {
  const secret = input.secret.trim();
  if (!secret) return false;

  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  const ts = Number(input.headers.timestamp);
  if (!Number.isFinite(ts)) return false;
  const tolerance = input.toleranceSec ?? SVIX_TOLERANCE_SEC;
  if (Math.abs(now - ts) > tolerance) return false;

  let key: Buffer;
  try {
    key = decodeWebhookSecret(secret);
  } catch {
    return false;
  }

  const signedContent = `${input.headers.id}.${input.headers.timestamp}.${input.body}`;
  const expected = createHmac("sha256", key).update(signedContent, "utf8").digest("base64");

  const parts = input.headers.signature.split(" ");
  for (const part of parts) {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) continue;
    if (safeEqualB64(sig, expected)) return true;
  }
  return false;
}
