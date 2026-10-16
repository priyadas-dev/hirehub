import { describe, expect, it, vi } from "vitest";
import { embedTextWithRetries } from "@/lib/ai/corpus-embed";
import {
  computeEmbedBackoffMs,
  parseRetryAfterMs,
  GEMINI_EMBEDDING_DIMENSIONS,
} from "@/lib/ai/gemini";

function vectorOf(length: number, fill = 0.01): number[] {
  return Array.from({ length }, (_, i) => fill + i * 0.0001);
}

function rateLimitResponse(retryAfter?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (retryAfter != null) headers.set("Retry-After", retryAfter);
  return new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", code: 429 } }), {
    status: 429,
    headers,
  });
}

describe("parseRetryAfterMs / computeEmbedBackoffMs", () => {
  it("parses Retry-After seconds and HTTP-date", () => {
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(parseRetryAfterMs("0")).toBe(0);
    expect(parseRetryAfterMs(null)).toBeNull();
    const future = new Date(Date.now() + 3000).toUTCString();
    const ms = parseRetryAfterMs(future);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThan(1000);
    expect(ms!).toBeLessThanOrEqual(120_000);
  });

  it("uses exponential backoff with jitter when Retry-After is absent", () => {
    const fixed = () => 0;
    expect(computeEmbedBackoffMs(1, null, fixed)).toBe(500);
    expect(computeEmbedBackoffMs(2, null, fixed)).toBe(1000);
    expect(computeEmbedBackoffMs(3, null, fixed)).toBe(2000);
  });

  it("prefers Retry-After over exponential base", () => {
    const fixed = () => 0;
    expect(computeEmbedBackoffMs(1, 3500, fixed)).toBe(3500);
  });
});

describe("embedTextWithRetries", () => {
  it("retries HTTP 429 then succeeds", async () => {
    const values = vectorOf(GEMINI_EMBEDDING_DIMENSIONS);
    const sleeps: number[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rateLimitResponse("1"))
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValueOnce(Response.json({ embedding: { values } }, { status: 200 }));

    const result = await embedTextWithRetries("React TypeScript", "test-key", {
      fetchImpl: fetchMock,
      maxAttempts: 5,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts).toBe(3);
      expect(result.embedding).toHaveLength(768);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps.length).toBe(2);
    expect(sleeps[0]).toBe(1000); // Retry-After: 1s
    expect(sleeps[1]).toBe(1000); // attempt 2 exponential base with random=0
  });

  it("stops after retry exhaustion on persistent 429", async () => {
    const fetchMock = vi.fn(async () => rateLimitResponse());
    const result = await embedTextWithRetries("hello", "test-key", {
      fetchImpl: fetchMock,
      maxAttempts: 3,
      sleep: async () => {},
      random: () => 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts).toBe(3);
      expect(result.diagnostic?.category).toBe("rate_limit");
      expect(result.diagnostic?.httpStatus).toBe(429);
      expect(result.diagnostic?.retryable).toBe(true);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry permanent 4xx invalid_argument", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: { status: "INVALID_ARGUMENT", code: 400 } }, { status: 400 }),
    );
    const sleep = vi.fn(async () => {});
    const result = await embedTextWithRetries("hello", "test-key", {
      fetchImpl: fetchMock,
      maxAttempts: 5,
      sleep,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts).toBe(1);
      expect(result.diagnostic?.category).toBe("invalid_argument");
      expect(result.diagnostic?.retryable).toBe(false);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries transient 5xx then recovers", async () => {
    const values = vectorOf(GEMINI_EMBEDDING_DIMENSIONS);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: { status: "UNAVAILABLE", code: 503 } }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ embedding: { values } }, { status: 200 }));

    const result = await embedTextWithRetries("skills", "test-key", {
      fetchImpl: fetchMock,
      maxAttempts: 4,
      sleep: async () => {},
      random: () => 0,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
