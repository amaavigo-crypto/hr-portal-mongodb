import assert from 'node:assert/strict';
import { cached, disableServerCache, enableServerCache, markDataChanged } from '../api/_lib/serverCache.ts';

let calls = 0;
const load = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return { n: calls }; };

// Off by default (Firestore fallback / tests): every read loads.
await cached('k', load); await cached('k', load);
assert.equal(calls, 2, 'disabled cache never stores');

enableServerCache();
calls = 0;
const [a, b] = await Promise.all([cached('k', load), cached('k', load)]);
assert.equal(calls, 1, 'identical requests in flight share one load');
assert.deepEqual(a, b);
await cached('k', load);
assert.equal(calls, 1, 'second read comes from the cache');

markDataChanged();
await cached('k', load);
assert.equal(calls, 2, 'a database write clears the cache');

// A write while loading: the result is returned but not kept.
const p = cached('w', load); markDataChanged(); await p; await cached('w', load);
assert.equal(calls, 4, 'result loaded across a write is not kept');

// keep(): failures are not stored.
let fails = 0;
const failing = async () => { fails++; return { status: 500 }; };
await cached('f', failing, { keep: (r) => r.status === 200 }); await cached('f', failing, { keep: (r) => r.status === 200 });
assert.equal(fails, 2, 'unsuccessful answers are not cached');

// Errors are not stored.
let errs = 0;
await assert.rejects(cached('e', async () => { errs++; throw new Error('x'); }));
await assert.rejects(cached('e', async () => { errs++; throw new Error('x'); }));
assert.equal(errs, 2);

// Expiry.
calls = 0;
await cached('t', load, { ttlMs: 20 }); await new Promise((r) => setTimeout(r, 30)); await cached('t', load, { ttlMs: 20 });
assert.equal(calls, 2, 'entries expire');

disableServerCache();
console.log('server cache: all checks passed');
