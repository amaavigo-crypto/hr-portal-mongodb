/**
 * Short-lived, in-memory cache for dashboard reads (Home cards, the personal dashboard, the hiring dashboard).
 *
 * - Results are kept for up to `ttlMs` (60 seconds by default) per key, and identical requests that arrive while one is
 *   still loading share that one load.
 * - Any database write through the MongoDB adapter clears everything on this server immediately, so a decision made on
 *   another screen shows up on the next read. (Another Vercel instance may still serve its copy until it expires.)
 * - Only active with the MongoDB adapter, which reports writes. With the Firestore fallback or the test fake it does
 *   nothing, so reads there are always fresh.
 */
type Entry = { at: number; version: number; value?: unknown; pending?: Promise<unknown> };

const MAX_ENTRIES = 2000;
const store = new Map<string, Entry>();
let version = 0;
let enabled = false;

/** Called by the MongoDB adapter once it is in use (it reports every write). */
export function enableServerCache() { enabled = true; }
/** Called when tests swap in a fake database that does not report writes. */
export function disableServerCache() { enabled = false; store.clear(); }
/** Called after every database write. */
export function markDataChanged() { version++; store.clear(); }

export function isServerCacheEnabled() { return enabled; }

export async function cached<T>(key: string, load: () => Promise<T>, opts: { ttlMs?: number; keep?: (value: T) => boolean } = {}): Promise<T> {
  if (!enabled) return load();
  const ttl = opts.ttlMs ?? 60_000;
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.version === version) {
    if (hit.pending) return hit.pending as Promise<T>;
    if (now - hit.at < ttl) return hit.value as T;
  }
  const started = version;
  const pending = load();
  store.set(key, { at: now, version: started, pending });
  try {
    const value = await pending;
    // Keep it only if nothing was written while it loaded, and the caller agrees (e.g. only successful answers).
    if (started === version && (opts.keep ? opts.keep(value) : true)) {
      if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value as string);
      store.set(key, { at: Date.now(), version: started, value });
    } else if (store.get(key)?.pending === pending) {
      store.delete(key);
    }
    return value;
  } catch (err) {
    if (store.get(key)?.pending === pending) store.delete(key);
    throw err;
  }
}
