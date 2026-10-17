import { NextResponse } from "next/server";

type Bucket = { hits: number[]; windowMs: number };

/**
 * In-memory sliding-window limiter.
 *
 * Note: state lives in the Node process, so it resets on restart and is not
 * shared between instances. For multi-instance deployments swap the Map for
 * Redis (same interface).
 */
const buckets = new Map<string, Bucket>();

// Drop expired entries so the Map cannot grow without bound.
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < bucket.windowMs);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

type WindowedBucket = Bucket;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  limit: number;
  /** Seconds the caller should wait before retrying. */
  retryAfter: number;
  resetMs: number;
};

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = (buckets.get(key) ?? { hits: [], windowMs }) as WindowedBucket;
  bucket.windowMs = windowMs;

  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    const resetMs = oldest + windowMs - now;
    buckets.set(key, bucket);
    return {
      allowed: false,
      remaining: 0,
      limit,
      retryAfter: Math.max(1, Math.ceil(resetMs / 1000)),
      resetMs,
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);

  return {
    allowed: true,
    remaining: limit - bucket.hits.length,
    limit,
    retryAfter: 0,
    resetMs: windowMs,
  };
}

export function clientIdentifier(request: Request, fallback = "unknown"): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || fallback;
}

export function rateLimitResponse(result: RateLimitResult, message: string) {
  return NextResponse.json(
    {
      error: "RATE_LIMITED",
      message,
      limit: result.limit,
      retryAfterSeconds: result.retryAfter,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfter),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil((Date.now() + result.resetMs) / 1000)),
      },
    },
  );
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil((Date.now() + result.resetMs) / 1000)),
  };
}

/** Named policies from the spec. */
export const AUTH_LIMIT = 5;
export const ORDER_LIMIT = 10;
export const WINDOW_MS = 60_000;

/**
 * Consumes capacity across every key. All keys must have room; a hit is only
 * recorded once every key has room, so a blocked request does not burn quota.
 */
function consume(
  keys: string[],
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  let tightest: RateLimitResult | null = null;

  for (const key of keys) {
    const bucket = (buckets.get(key) ?? { hits: [], windowMs }) as Bucket;
    bucket.windowMs = windowMs;
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
    buckets.set(key, bucket);

    const resetMs = (bucket.hits[0] ?? now) + windowMs - now;
    const result: RateLimitResult = {
      allowed: bucket.hits.length < limit,
      remaining: Math.max(0, limit - bucket.hits.length),
      limit,
      retryAfter: Math.max(1, Math.ceil(resetMs / 1000)),
      resetMs,
    };

    if (!result.allowed && (!tightest || result.resetMs > tightest.resetMs)) {
      tightest = result;
    }
  }

  if (tightest) return tightest;

  for (const key of keys) {
    const bucket = buckets.get(key)!;
    bucket.hits.push(now);
  }

  return {
    allowed: true,
    remaining: limit - 1,
    limit,
    retryAfter: 0,
    resetMs: windowMs,
  };
}

/**
 * Auth traffic is limited per IP *and* per identifier, so neither a single
 * sprayed IP nor a single targeted account can brute-force the other.
 */
export function authLimiter(request: Request, identifier?: string) {
  const keys = [`auth:ip:${clientIdentifier(request)}`];
  if (identifier && identifier.trim().length > 0) {
    keys.push(`auth:id:${identifier.trim().toLowerCase()}`);
  }
  return consume(keys, AUTH_LIMIT, WINDOW_MS);
}

export function orderLimiter(request: Request, identifier: string) {
  return consume(
    [`order:user:${identifier}`, `order:ip:${clientIdentifier(request)}`],
    ORDER_LIMIT,
    WINDOW_MS,
  );
}

export function resetRateLimits() {
  buckets.clear();
  lastSweep = 0;
}
