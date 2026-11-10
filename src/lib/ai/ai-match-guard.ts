/**
 * Track 6 — rate-limit + short TTL cache for the AI live-job match path.
 * Process-local only (fine for single Node instance / serverless warm isolates).
 * Never logs query text or PII.
 */

export type AiMatchRateLimitConfig = {
  /** Max successful/attempted match requests per window per user. */
  maxRequests: number;
  /** Sliding window length in ms. */
  windowMs: number;
};

export type AiMatchCacheConfig = {
  /** Cache TTL for identical user+query match results. */
  ttlMs: number;
  /** Soft cap on cached entries (oldest by expiry evicted). */
  maxEntries: number;
};

export type AiMatchGuardConfig = AiMatchRateLimitConfig & AiMatchCacheConfig;

export const DEFAULT_AI_MATCH_GUARD: AiMatchGuardConfig = {
  maxRequests: 20,
  windowMs: 60_000,
  ttlMs: 30_000,
  maxEntries: 200,
};

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number; remaining: 0 };

type TimestampBucket = number[];

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export function normalizeMatchCacheKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

export function buildAiMatchCacheKey(userId: string, query: string): string {
  return `${userId}::${normalizeMatchCacheKey(query)}`;
}

/** Pure sliding-window check (mutates `buckets` map for the caller). */
export function evaluateRateLimit(
  buckets: Map<string, TimestampBucket>,
  userId: string,
  now: number,
  config: AiMatchRateLimitConfig,
): RateLimitDecision {
  const windowStart = now - config.windowMs;
  const prior = buckets.get(userId) ?? [];
  const recent = prior.filter((t) => t > windowStart);

  if (recent.length >= config.maxRequests) {
    const oldest = recent[0] ?? now;
    const retryAfterMs = Math.max(0, oldest + config.windowMs - now);
    buckets.set(userId, recent);
    return { allowed: false, retryAfterMs, remaining: 0 };
  }

  recent.push(now);
  buckets.set(userId, recent);
  return { allowed: true, remaining: Math.max(0, config.maxRequests - recent.length) };
}

export function getCachedMatchResult<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  now: number,
): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

export function setCachedMatchResult<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  now: number,
  config: AiMatchCacheConfig,
): void {
  if (cache.size >= config.maxEntries) {
    // Evict expired first, then earliest expiry.
    for (const [k, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(k);
    }
    if (cache.size >= config.maxEntries) {
      let oldestKey: string | undefined;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [k, entry] of cache) {
        if (entry.expiresAt < oldestAt) {
          oldestAt = entry.expiresAt;
          oldestKey = k;
        }
      }
      if (oldestKey) cache.delete(oldestKey);
    }
  }
  cache.set(key, { value, expiresAt: now + config.ttlMs });
}

export type AiMatchGuard = {
  checkRateLimit: (userId: string, now?: number) => RateLimitDecision;
  getCached: <T>(userId: string, query: string, now?: number) => T | undefined;
  setCached: <T>(userId: string, query: string, value: T, now?: number) => void;
  /** Test helper */
  reset: () => void;
};

export function createAiMatchGuard(config: AiMatchGuardConfig = DEFAULT_AI_MATCH_GUARD): AiMatchGuard {
  const buckets = new Map<string, TimestampBucket>();
  const cache = new Map<string, CacheEntry<unknown>>();

  return {
    checkRateLimit(userId, now = Date.now()) {
      return evaluateRateLimit(buckets, userId, now, config);
    },
    getCached(userId, query, now = Date.now()) {
      return getCachedMatchResult(cache, buildAiMatchCacheKey(userId, query), now) as
        | ReturnType<AiMatchGuard["getCached"]>
        | undefined;
    },
    setCached(userId, query, value, now = Date.now()) {
      setCachedMatchResult(cache, buildAiMatchCacheKey(userId, query), value, now, config);
    },
    reset() {
      buckets.clear();
      cache.clear();
    },
  };
}

/** Shared process guard for the live match / assistant path. */
export const aiMatchGuard = createAiMatchGuard();

export function rateLimitedAssistantMessage(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `You're sending match requests too quickly. Please wait about ${seconds}s and try again.`;
}
