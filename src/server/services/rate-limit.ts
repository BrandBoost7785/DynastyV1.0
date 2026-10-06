/**
 * Request rate limiting.
 *
 * A fixed-window counter per key (authenticated user id, or client IP for the
 * unauthenticated endpoints). Two budgets come from the balancing config: a broad
 * one for all API traffic and a tighter one for intents that mutate a save, which
 * is where an automated client could otherwise hammer the simulation.
 *
 * Scope and its limits, stated plainly: this is per-process. A horizontally scaled
 * deployment gives each instance its own budget, so the effective limit is
 * `instances × limit`. That is the right trade-off here — it needs no external
 * dependency, it cannot become a latency source on every request, and the budgets
 * are generous enough that the multiplication does not create an abuse vector.
 * Swapping in a shared counter (a Postgres table or Redis) means replacing
 * `consume`, and nothing else calls into the storage.
 */
import { getBalance } from '../../config/balance';

const B = getBalance();

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

export interface RateLimitBudget {
  limit: number;
  windowMs: number;
}

export const READ_BUDGET: RateLimitBudget = { limit: B.api.rateLimitMaxRequests, windowMs: B.api.rateLimitWindowMs };
export const ACTION_BUDGET: RateLimitBudget = { limit: B.api.actionRateLimitMaxRequests, windowMs: B.api.actionRateLimitWindowMs };

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Milliseconds until the window resets; 0 when allowed. */
  retryAfterMs: number;
  resetAt: number;
}

function sweep(now: number): void {
  // Amortised cleanup: at most once per second, and only when the map is growing.
  if (now - lastSweep < 1000 || buckets.size < 512) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function consume(key: string, budget: RateLimitBudget = READ_BUDGET, now = Date.now()): RateLimitResult {
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + budget.windowMs });
    return { allowed: true, limit: budget.limit, remaining: budget.limit - 1, retryAfterMs: 0, resetAt: now + budget.windowMs };
  }
  bucket.count += 1;
  if (bucket.count > budget.limit) {
    return { allowed: false, limit: budget.limit, remaining: 0, retryAfterMs: Math.max(0, bucket.resetAt - now), resetAt: bucket.resetAt };
  }
  return { allowed: true, limit: budget.limit, remaining: budget.limit - bucket.count, retryAfterMs: 0, resetAt: bucket.resetAt };
}

/** Headers a route handler should attach so a client can back off politely. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'ratelimit-limit': String(result.limit),
    'ratelimit-remaining': String(Math.max(0, result.remaining)),
    'ratelimit-reset': String(Math.ceil(result.resetAt / 1000)),
    ...(result.allowed ? {} : { 'retry-after': String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))) }),
  };
}

/** Test helper: drop every bucket. */
export function resetRateLimits(): void {
  buckets.clear();
  lastSweep = 0;
}
