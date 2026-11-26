/**
 * Founders Dashboard feed: the pure builder, the key-protected endpoint, privacy, and activity tracking.
 * Run: npx tsx tests/founderMetrics.test.ts
 */
import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { authenticate } from '../api/_lib/authContext.ts';
import { __resetActivityThrottle, recordActivity } from '../api/_lib/userActivity.ts';
import { __resetFounderCache, founderMetrics, keyMatches } from '../api/_lib/founderApi.ts';
import { AT_RISK_DAYS, LIMITS, buildMetrics, lastActiveText, type FounderInput } from '../shared/founderMetrics.ts';

const NOW = new Date('2026-11-26T10:00:00Z');
const ago = (days: number, hours = 0) => new Date(NOW.getTime() - days * 86_400_000 - hours * 3_600_000).toISOString();
const MODULE_LABELS = { 'document-version-control': 'Document Version Control', 'talent-acquisition': 'Talent Acquisition' };

// ------------------------------------------------------------------ the pure builder
const input: FounderInput = {
  now: NOW,
  moduleLabels: MODULE_LABELS,
  companies: [
    { id: 'c1', name: 'Acme Corp', status: 'ACTIVE', plan: 'growth', modules: ['document-version-control', 'talent-acquisition'], createdAt: ago(61), approvedAt: ago(60) },
    { id: 'c2', name: 'Beta Ltd', status: 'ACTIVE', plan: 'trial', modules: ['document-version-control'], createdAt: ago(31), approvedAt: ago(30) },
    { id: 'c3', name: 'Gamma Inc', status: 'ACTIVE', plan: 'trial', modules: [], createdAt: ago(0, 3), approvedAt: ago(0, 2) },
    { id: 'c4', name: 'Delta Co', status: 'PENDING', plan: 'trial', modules: [], createdAt: ago(4) },
    { id: 'c5', name: 'Echo LLC', status: 'SUSPENDED', plan: 'trial', modules: [], createdAt: ago(90), updatedAt: ago(0, 3) },
  ],
  employees: [
    ...Array.from({ length: 3 }, () => ({ companyId: 'c1', active: true })),
    { companyId: 'c1', active: false },
    { companyId: 'c2', active: true }, { companyId: 'c2' },
    ...Array.from({ length: 5 }, () => ({ companyId: 'c5', active: true })),
  ],
  activity: [
    { uid: 'u1', companyId: 'c1', firstSeenAt: ago(20), lastSeenAt: ago(0, 2) },
    { uid: 'u2', companyId: 'c1', firstSeenAt: ago(20), lastSeenAt: ago(3) },
    { uid: 'u3', companyId: 'c1', firstSeenAt: ago(20), lastSeenAt: ago(20) },
    { uid: 'u4', companyId: 'c2', firstSeenAt: ago(20), lastSeenAt: ago(10) },
    { uid: 'u5', companyId: 'c5', firstSeenAt: ago(20), lastSeenAt: ago(0, 1) }, // a suspended company never counts
  ],
};
const m = buildMetrics(input);

assert.equal(m.contract_version, 1);
assert.equal(m.generated_at, NOW.toISOString());
assert.deepEqual(m.labels, { customers: 'Companies', size: 'Employees', trend: 'Daily active users' });
assert.deepEqual(m.customers, { total: 3, new: 1, churned: 1 }, 'active companies; Gamma approved today; Echo suspended today');
assert.deepEqual(m.users, { active_daily: 1, active_weekly: 2, active_monthly: 4 });
assert.equal(m.trend_value, 1);
assert.equal('money' in m, false, 'revenue is entered in the dashboard, so it is never sent from here');
assert.equal('ai_cost_by_customer' in m, false);
assert.deepEqual(m.headline.map((h) => [h.label, h.value]), [
  ['Companies', '3'], ['Employees managed', '5'], ['Active users (30 days)', '4'], ['Waiting for approval', '1'],
]);
assert.deepEqual(m.customers_list.map((c) => [c.name, c.plan, c.size, c.last_active, c.status]), [
  ['Acme Corp', 'Growth', '3', 'Today', 'active'],
  ['Beta Ltd', 'Trial', '2', '10 days ago', 'quiet'],
  ['Gamma Inc', 'Trial', '0', 'Not seen yet', 'active'],
], 'newest sign-in first; a company approved this week is not blamed for being quiet; inactive and suspended people are not counted');
assert.deepEqual(m.attention.map((a) => [a.level, a.title]), [
  ['critical', '1 company is waiting for approval (longest 4 days)'],
  ['info', '1 active company has no employees added yet'],
  ['info', '1 company is suspended'],
]);
assert.deepEqual(m.panel?.rows, [
  { label: 'Trial plan', value: '2 of 3', pct: 67 },
  { label: 'Growth plan', value: '1 of 3', pct: 33 },
  { label: 'Document Version Control', value: '2 of 3', pct: 67 },
  { label: 'Talent Acquisition', value: '1 of 3', pct: 33 },
]);

// a company that has been silent for 14+ days is flagged once there is enough history to say so
const silent = buildMetrics({ ...input, activity: input.activity.map((a) => (a.companyId === 'c2' ? { ...a, lastSeenAt: ago(AT_RISK_DAYS + 3) } : a)) });
assert.equal(silent.customers_list.find((c) => c.name === 'Beta Ltd')?.status, 'at_risk');
assert.ok(silent.attention.some((a) => a.level === 'warn' && /no sign-ins for 14\+ days: Beta Ltd/.test(a.title)));

// before tracking has existed for two weeks, "quiet" would be a false alarm, so it is not claimed
const fresh = buildMetrics({ ...input, activity: [{ uid: 'u1', companyId: 'c1', firstSeenAt: ago(3), lastSeenAt: ago(0, 2) }] });
assert.deepEqual(fresh.customers_list.map((c) => c.status), ['active', 'active', 'active']);
assert.equal(fresh.attention.some((a) => /no sign-ins/.test(a.title)), false);
const none = buildMetrics({ ...input, activity: [] });
assert.deepEqual([none.users.active_daily, none.customers_list[0].last_active], [0, 'Not tracked yet']);
assert.deepEqual(none.customers_list.map((c) => c.status), ['active', 'active', 'active']);

// nothing at all
const empty = buildMetrics({ now: NOW, companies: [], employees: [], activity: [], moduleLabels: MODULE_LABELS });
assert.deepEqual([empty.customers.total, empty.customers_list.length, empty.attention.length, 'panel' in empty], [0, 0, 0, false]);

// the dashboard rejects a payload that breaks its limits, so the builder must never exceed them
const big = buildMetrics({
  now: NOW, moduleLabels: MODULE_LABELS,
  companies: Array.from({ length: 80 }, (_, i) => ({ id: `k${i}`, name: `Company ${i}`, status: 'ACTIVE', plan: `plan${i % 6}`, modules: Object.keys(MODULE_LABELS).concat(Array.from({ length: 12 }, (_, j) => `m${j}`)), approvedAt: ago(100) })),
  employees: [], activity: [],
});
assert.equal(big.customers_list.length, LIMITS.customers);
assert.ok((big.panel?.rows.length || 0) <= LIMITS.panelRows);
assert.ok(big.headline.length <= LIMITS.headline && big.attention.length <= LIMITS.attention);
assert.ok(big.panel!.rows.every((r) => r.pct >= 0 && r.pct <= 100));
assert.equal(lastActiveText(NOW.getTime() - 30 * 3_600_000, NOW.getTime()), 'Yesterday');

// ------------------------------------------------------------------ the endpoint
const KEY = 'k'.repeat(8) + 'f0unders-metrics-key-1234567890';
assert.ok(KEY.length >= 24);
const fdb = new FakeFirestore();
const claimsHeader = (claims: Record<string, any>) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify(claims)).toString('base64')}` });
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });

for (const c of input.companies) {
  const { id, ...rest } = c;
  await fdb.collection('companies').doc(id).set(rest);
}
let n = 0;
for (const e of input.employees) {
  await fdb.collection('employees').doc(`e${n++}`).set({ ...e, name: 'Secret Person', email: 'secret.person@acme.com', authUid: `auth${n}` });
}
for (const a of input.activity) await fdb.collection('userActivity').doc(a.uid).set(a);

delete process.env.FOUNDER_METRICS_KEY;
assert.equal((await founderMetrics({ authorization: `Bearer ${KEY}` }, NOW)).status, 503, 'switched off until a key is set');
process.env.FOUNDER_METRICS_KEY = 'short';
assert.equal((await founderMetrics({ authorization: 'Bearer short' }, NOW)).status, 503, 'a short key is refused outright');

process.env.FOUNDER_METRICS_KEY = KEY;
__resetFounderCache();
assert.equal((await founderMetrics({}, NOW)).status, 401, 'no header');
assert.equal((await founderMetrics({ authorization: 'Bearer wrong' }, NOW)).status, 401);
assert.equal((await founderMetrics({ authorization: `Bearer ${KEY.slice(0, -1)}x` }, NOW)).status, 401, 'one character off');
assert.equal((await founderMetrics({ authorization: KEY.slice(0, 10) }, NOW)).status, 401);
assert.equal((await founderMetrics(claimsHeader({ uid: 'u1', cid: 'c1', cs: 'ACTIVE', adm: true }), NOW)).status, 401, 'a signed-in company admin is not the dashboard');
assert.equal(keyMatches(KEY, KEY), true);
assert.equal(keyMatches('', ''), false);

const ok = await founderMetrics({ authorization: `Bearer ${KEY}` }, NOW);
assert.equal(ok.status, 200);
assert.deepEqual(ok.json, m, 'the endpoint returns exactly what the builder produces from the stored rows');

// privacy: company names yes; anything about a single person never
const text = JSON.stringify(ok.json);
assert.ok(text.includes('Acme Corp'));
for (const secret of ['Secret Person', 'secret.person', '@acme.com', 'auth1', 'u1', 'uid']) assert.equal(text.includes(secret), false, `"${secret}" must not appear in the feed`);

// cache: a change shows up after five minutes, not before
await fdb.collection('companies').doc('c6').set({ name: 'Zeta Ltd', status: 'ACTIVE', plan: 'trial', modules: [], createdAt: ago(40), approvedAt: ago(40) });
assert.equal((await founderMetrics({ authorization: `Bearer ${KEY}` }, new Date(NOW.getTime() + 4 * 60_000))).json.customers.total, 3);
assert.equal((await founderMetrics({ authorization: `Bearer ${KEY}` }, new Date(NOW.getTime() + 6 * 60_000))).json.customers.total, 4);

// the feed only ever reads
const before = JSON.stringify(['companies', 'employees', 'userActivity'].map((c) => (fdb as any).stores?.get(c) ? [...(fdb as any).stores.get(c).entries()] : []));
__resetFounderCache();
await founderMetrics({ authorization: `Bearer ${KEY}` }, new Date(NOW.getTime() + 20 * 60_000));
const after = JSON.stringify(['companies', 'employees', 'userActivity'].map((c) => (fdb as any).stores?.get(c) ? [...(fdb as any).stores.get(c).entries()] : []));
assert.equal(after, before, 'reading the feed changes nothing');

// ------------------------------------------------------------------ activity tracking
const adb = new FakeFirestore();
__useFakeAdmin({ db: adb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const who = (uid: string, extra: Record<string, any> = {}) => claimsHeader({ uid, email: `${uid}@acme.com`, cid: 'c1', cs: 'ACTIVE', perms: [], adm: false, ...extra });

// the other tests assert exact writes, so tracking stays off under a fake database unless a test opts in
delete process.env.TRACK_ACTIVITY_IN_TESTS;
__resetActivityThrottle();
await authenticate(who('quiet-user'));
assert.equal((await adb.collection('userActivity').doc('quiet-user').get()).exists, false);

process.env.TRACK_ACTIVITY_IN_TESTS = '1';
__resetActivityThrottle();
const ctx = await authenticate(who('u1'));
assert.equal(ctx.uid, 'u1', 'signing in still works exactly as before');
const first = (await adb.collection('userActivity').doc('u1').get()).data() as any;
assert.deepEqual([first.uid, first.companyId], ['u1', 'c1']);
assert.ok(first.firstSeenAt && first.firstSeenAt === first.lastSeenAt);
assert.deepEqual(Object.keys(first).sort(), ['companyId', 'firstSeenAt', 'lastSeenAt', 'uid'], 'only who, which company and when: no page, no action, no content');

await authenticate(who('u1')); // within the hour: no second write
assert.equal(((await adb.collection('userActivity').doc('u1').get()).data() as any).lastSeenAt, first.lastSeenAt);

await authenticate(who('admin-1', { cid: undefined, pa: true })); // a platform administrator has no company
assert.equal((await adb.collection('userActivity').doc('admin-1').get()).exists, false);

// a later visit moves lastSeenAt but never firstSeenAt
await recordActivity(adb, 'u1', 'c1', Date.parse(first.lastSeenAt) + 3 * 3_600_000);
const later = (await adb.collection('userActivity').doc('u1').get()).data() as any;
assert.equal(later.firstSeenAt, first.firstSeenAt);
assert.ok(Date.parse(later.lastSeenAt) > Date.parse(first.lastSeenAt));

// a failing database must never fail the request
__useFakeAdmin({
  db: { collection: () => { throw new Error('database down'); } },
  auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) },
});
__resetActivityThrottle();
assert.equal((await authenticate(who('u9'))).uid, 'u9');
delete process.env.TRACK_ACTIVITY_IN_TESTS;

console.log('founderMetrics: all checks passed');
