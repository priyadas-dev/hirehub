import { describe, expect, it } from "vitest";
import {
  buildAiMatchCacheKey,
  createAiMatchGuard,
  evaluateRateLimit,
  getCachedMatchResult,
  normalizeMatchCacheKey,
  rateLimitedAssistantMessage,
  setCachedMatchResult,
} from "@/lib/ai/ai-match-guard";

describe("ai-match-guard", () => {
  it("normalizes cache keys without leaking whitespace noise", () => {
    expect(normalizeMatchCacheKey("  Remote  React  jobs ")).toBe("remote react jobs");
    expect(buildAiMatchCacheKey("user-1", "Remote React")).toBe("user-1::remote react");
  });

  it("allows requests under the limit and blocks after maxRequests", () => {
    const buckets = new Map<string, number[]>();
    const config = { maxRequests: 3, windowMs: 60_000 };
    const t0 = 1_000_000;

    expect(evaluateRateLimit(buckets, "u1", t0, config).allowed).toBe(true);
    expect(evaluateRateLimit(buckets, "u1", t0 + 10, config).allowed).toBe(true);
    expect(evaluateRateLimit(buckets, "u1", t0 + 20, config).allowed).toBe(true);

    const blocked = evaluateRateLimit(buckets, "u1", t0 + 30, config);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterMs).toBeGreaterThan(0);
      expect(rateLimitedAssistantMessage(blocked.retryAfterMs)).toMatch(/too quickly/i);
    }

    // Different user is independent.
    expect(evaluateRateLimit(buckets, "u2", t0 + 30, config).allowed).toBe(true);
  });

  it("expires cache entries after TTL", () => {
    const cache = new Map<string, { value: string; expiresAt: number }>();
    const config = { ttlMs: 1_000, maxEntries: 10 };
    setCachedMatchResult(cache, "k", "jobs", 1000, config);
    expect(getCachedMatchResult(cache, "k", 1500)).toBe("jobs");
    expect(getCachedMatchResult(cache, "k", 2100)).toBeUndefined();
  });

  it("shared guard instance rate-limits then recovers after window", () => {
    const guard = createAiMatchGuard({
      maxRequests: 2,
      windowMs: 100,
      ttlMs: 50,
      maxEntries: 10,
    });
    const t0 = Date.now();
    expect(guard.checkRateLimit("seeker-a", t0).allowed).toBe(true);
    expect(guard.checkRateLimit("seeker-a", t0 + 1).allowed).toBe(true);
    expect(guard.checkRateLimit("seeker-a", t0 + 2).allowed).toBe(false);
    expect(guard.checkRateLimit("seeker-a", t0 + 150).allowed).toBe(true);

    guard.setCached("seeker-a", "react jobs", { jobs: ["1"] }, t0);
    expect(guard.getCached("seeker-a", "react jobs", t0 + 10)).toEqual({ jobs: ["1"] });
    expect(guard.getCached("seeker-a", "react jobs", t0 + 60)).toBeUndefined();
  });
});
