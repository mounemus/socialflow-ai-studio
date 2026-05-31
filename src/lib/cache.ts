/**
 * cache.ts — a tiny, dependency-free in-memory TTL cache.
 *
 * IMPORTANT — scope & guarantees:
 *   - This cache lives in a MODULE-LEVEL Map, so it is PER-INSTANCE only.
 *     On serverless (Vercel) each warm Lambda/edge instance keeps its OWN copy.
 *     There is NO cross-instance coordination: a value cached on instance A is
 *     invisible to instance B, and invalidate() only clears the local instance.
 *   - It is therefore BEST-EFFORT, advisory caching. Treat every cached value as
 *     "may be up to `ttlMs` stale, on this instance only". Never use it for data
 *     that must be strongly consistent or transactional.
 *   - Its purpose is to SMOOTH repeated reads within a single warm instance
 *     (e.g. the same dashboard re-fetching the same heavy snapshot a few times
 *     within a short window). Cold starts simply repopulate.
 *
 * Multi-tenant safety:
 *   - Keys are opaque strings. CALLERS MUST include orgId (and brandId where
 *     relevant) in the key so tenants never share a cache entry. This module
 *     does not — and cannot — enforce that; it just keys on the string given.
 *
 * Stampede protection:
 *   - The in-flight Promise is stored immediately, so concurrent callers for the
 *     same fresh-miss key share ONE execution of `fn` instead of all racing it.
 *   - If `fn` rejects, the entry is removed so the next call retries (we never
 *     cache a rejected promise).
 */

interface Entry<T> {
  // Either a resolved value (with an absolute expiry) or an in-flight promise.
  promise: Promise<T>;
  expiresAt: number;
}

const MAX_ENTRIES = 500;

// Module-level store. Map preserves insertion order, which we exploit for a
// cheap "evict oldest" policy when we hit the size cap.
const store = new Map<string, Entry<unknown>>();

function evictIfNeeded(): void {
  while (store.size > MAX_ENTRIES) {
    // Oldest inserted key is first in iteration order.
    const oldest = store.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/**
 * Return a cached value for `key` if present and fresh; otherwise run `fn`,
 * cache its result for `ttlMs`, and return it. Concurrent callers for the same
 * key share a single in-flight `fn` execution (stampede dedupe).
 */
export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = store.get(key) as Entry<T> | undefined;

  // Fresh hit (covers both resolved values and still-pending in-flight promises
  // whose deadline has not passed).
  if (existing && existing.expiresAt > now) {
    return existing.promise;
  }

  // Miss or stale: run fn and store the in-flight promise immediately so that
  // concurrent callers dedupe onto it.
  const promise = (async () => fn())().catch((err) => {
    // Don't cache failures — drop the entry so the next call retries.
    if (store.get(key)?.promise === promise) {
      store.delete(key);
    }
    throw err;
  });

  const entry: Entry<T> = { promise, expiresAt: now + ttlMs };
  // Re-insert at the end of iteration order for the LRU-ish eviction.
  store.delete(key);
  store.set(key, entry as Entry<unknown>);
  evictIfNeeded();

  return promise;
}

/**
 * Drop every cache entry whose key starts with `prefix`.
 * Best-effort and local to this instance (see file header).
 */
export function invalidate(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

/** Test/diagnostic helper: clear the entire cache. */
export function __clearCache(): void {
  store.clear();
}
