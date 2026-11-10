import { describe, expect, it } from "vitest";
import {
  isBrowserSentryConfigured,
  isServerSentryConfigured,
} from "@/lib/observability/sentry";

describe("sentry observability wiring", () => {
  it("reports disabled when no DSN is set (safe default)", () => {
    const prev = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    expect(isServerSentryConfigured()).toBe(false);
    expect(isBrowserSentryConfigured()).toBe(false);
    if (prev !== undefined) process.env.SENTRY_DSN = prev;
  });

  it("detects server DSN when present without initializing network", () => {
    const prev = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";
    expect(isServerSentryConfigured()).toBe(true);
    if (prev === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = prev;
  });
});
