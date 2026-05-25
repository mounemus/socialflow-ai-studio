/**
 * In-memory token bucket. Replace with Upstash Ratelimit in production.
 */
type Bucket = { tokens: number; lastRefill: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit = 60, intervalMs = 60_000): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: limit, lastRefill: now };
  const elapsed = now - b.lastRefill;
  const refill = (elapsed / intervalMs) * limit;
  b.tokens = Math.min(limit, b.tokens + refill);
  b.lastRefill = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}
