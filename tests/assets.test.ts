import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routePrefixed } from '../api/_lib/prefixRouter.ts';
import { bookValue, transition, warrantyState } from '../shared/assets.ts';

// ---- rules
assert.deepEqual(transition('IN_STOCK', 'assign'), { ok: true, to: 'ASSIGNED' });
assert.equal(transition('ASSIGNED', 'assign').ok, false); assert.equal(transition('RETIRED', 'assign').ok, false); assert.equal(transition('ASSIGNED', 'retire').ok, false, 'must be returned first');
assert.equal(transition('LOST', 'found').ok, true); assert.equal(transition('IN_REPAIR', 'repair_done').ok, true); assert.equal(transition('IN_STOCK', 'repair_done').ok, false);
const A = { cost: 120000, salvage: 12000, purchaseDate: '2024-01-15', usefulLifeMonths: 36 };
assert.equal(bookValue(A, '2024-01-15'), 120000);
assert.equal(bookValue(A, '2025-01-15'), 84000, 'a third of 108000 gone after 12 months');
assert.equal(bookValue(A, '2025-01-14'), 87000, 'the 12th month is not complete');
assert.equal(bookValue(A, '2030-01-01'), 12000, 'never below salvage');
assert.equal(bookValue({ ...A, purchaseDate: '' }, '2025-01-01'), 120000); assert.equal(bookValue({ ...A, usefulLifeMonths: 0 }, '2025-01-01'), 120000);
assert.equal(bookValue(A, '2023-01-01'), 120000, 'before purchase');
assert.equal(warrantyState('', '2026-01-01'), 'UNKNOWN'); assert.equal(warrantyState('2025-12-31', '2026-01-01'), 'EXPIRED');
assert.equal(warrantyState('2026-02-15', '2026-01-01'), 'EXPIRING'); assert.equal(warrantyState('2027-01-01', '2026-01-01'), 'IN_WARRANTY');

// ---- API
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const tok = (uid: string, perms: string[] = [], cid = 'c1') => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@a.com`, cid, cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const IT = tok('it', ['asset.manage']), U1 = tok('u1'), U2 = tok('u2');
fdb.seed('companies', 'c1', { name: 'A' }); fdb.seed('companies', 'c2', { name: 'B' });
for (const [uid, active] of [['it', true], ['u1', true], ['u2', true], ['gone', false]] as const) fdb.seed('employees', uid, { companyId: 'c1', authUid: uid, name: `Person ${uid}`, email: `${uid}@a.com`, active, createdAt: '2020-01-01T00:00:00Z' });
const call = async (h: any, method: string, action: string, body: any = {}, query: any = {}) => (await routePrefixed(`assets-${action}`, { method, query, body, headers: h }))!;

assert.equal((await call(U1, 'POST', 'save', { tag: 'x', name: 'y' })).status, 403);
assert.equal((await call(U1, 'GET', 'list')).status, 403);
assert.equal((await call(IT, 'POST', 'save', { tag: '', name: 'y' })).status, 400);
assert.equal((await call(IT, 'POST', 'save', { tag: 'LAP-1', name: 'Laptop', cost: -5 })).status, 400);
assert.equal((await call(IT, 'POST', 'save', { tag: 'LAP-1', name: 'Laptop', cost: 100, salvage: 200 })).status, 400);
assert.equal((await call(IT, 'POST', 'save', { tag: 'LAP-1', name: 'Laptop', purchaseDate: '2024-02-31' })).status, 400, 'impossible date');
let r = await call(IT, 'POST', 'save', { tag: 'lap-1', name: 'Laptop', category: 'Laptops', cost: 120000, salvage: 12000, usefulLifeMonths: 36, purchaseDate: '2024-01-15', warrantyUntil: '2030-01-01' });
assert.equal(r.status, 200, JSON.stringify(r.json)); const id = r.json.id;
assert.equal((await call(IT, 'POST', 'save', { tag: 'LAP-1', name: 'Dup' })).status, 409, 'tags are unique (case-insensitive)');
assert.equal((await call(IT, 'POST', 'save', { id, tag: 'LAP-1', name: 'Laptop Pro', cost: 120000, salvage: 12000, usefulLifeMonths: 36, purchaseDate: '2024-01-15' })).status, 200, 'editing keeps its own tag');

assert.equal((await call(IT, 'POST', 'act', { id, action: 'assign', uid: 'gone' })).status, 400, 'inactive employees cannot hold assets');
assert.equal((await call(IT, 'POST', 'act', { id, action: 'assign', uid: 'nobody' })).status, 400);
assert.equal((await call(IT, 'POST', 'act', { id, action: 'return' })).status, 409, 'nothing to return');
assert.equal((await call(IT, 'POST', 'act', { id, action: 'dance' })).status, 400);
assert.equal((await call(IT, 'POST', 'act', { id, action: 'assign', uid: 'u1' })).status, 200);
assert.equal((await call(IT, 'POST', 'act', { id, action: 'assign', uid: 'u2' })).status, 409, 'already assigned');
assert.equal((await call(IT, 'POST', 'act', { id, action: 'retire' })).status, 409, 'return it first');
assert.equal((await call(U1, 'GET', 'mine')).json.items.length, 1); assert.equal((await call(U2, 'GET', 'mine')).json.items.length, 0);
assert.equal((await call(U2, 'POST', 'acknowledge', { id })).status, 404, 'only the assignee can acknowledge');
assert.equal((await call(U1, 'POST', 'acknowledge', { id })).status, 200);
assert.equal((await call(U1, 'GET', 'get', {}, { id })).status, 200, 'the assignee can open it'); assert.equal((await call(U2, 'GET', 'get', {}, { id })).status, 404);
r = await call(IT, 'GET', 'pending', {}, { uid: 'u1' }); assert.equal(r.json.clear, false); assert.equal(r.json.items.length, 1);
assert.equal((await call(U1, 'GET', 'pending', {}, { uid: 'u1' })).status, 403);
assert.equal((await call(IT, 'POST', 'act', { id, action: 'return', condition: 'BROKEN' })).status, 400);
assert.equal((await call(IT, 'POST', 'act', { id, action: 'return', condition: 'damaged', note: 'cracked screen' })).status, 200);
assert.equal((await call(IT, 'GET', 'pending', {}, { uid: 'u1' })).json.clear, true);
assert.equal((await call(IT, 'POST', 'act', { id, action: 'send_repair' })).status, 200);
assert.equal((await call(IT, 'POST', 'act', { id, action: 'repair_done' })).status, 200);
const g = (await call(IT, 'GET', 'get', {}, { id })).json.asset;
assert.equal(g.status, 'IN_STOCK'); assert.deepEqual(g.history.map((h: any) => h.action), ['ADDED', 'EDITED', 'ASSIGN', 'ACKNOWLEDGED', 'RETURN', 'SEND_REPAIR', 'REPAIR_DONE']);
assert.equal(g.history[4].condition, 'DAMAGED'); assert.equal(g.warranty, 'UNKNOWN');
assert.equal((await call(IT, 'POST', 'act', { id, action: 'lost' })).status, 200);
assert.equal((await call(IT, 'POST', 'act', { id, action: 'found' })).status, 200);
assert.equal((await call(IT, 'POST', 'act', { id, action: 'retire' })).status, 200);
assert.equal((await call(IT, 'POST', 'act', { id, action: 'assign', uid: 'u1' })).status, 409, 'retired is final');
assert.equal((await call(IT, 'GET', 'get', {}, { id })).json.asset.bookValue, 0, 'retired assets carry no book value');

r = await call(IT, 'POST', 'import', { rows: [{ tag: 'PH-1', name: 'Phone', cost: 30000 }, { tag: 'PH-1', name: 'Dup' }, { tag: 'LAP-1', name: 'Clash' }, { name: 'No tag' }, { tag: 'DK-1', name: 'Desk', cost: 5, salvage: 9 }, { tag: 'MN-1', name: 'Monitor' }] });
assert.equal(r.json.added, 2); assert.equal(r.json.problems.length, 4);
assert.equal((await call(IT, 'POST', 'import', { rows: [] })).status, 400);
r = await call(IT, 'GET', 'list', {}, { q: 'phone' }); assert.equal(r.json.items.length, 1);
r = await call(IT, 'GET', 'list', {}, { status: 'RETIRED' }); assert.equal(r.json.items.length, 1);
r = await call(IT, 'GET', 'summary'); assert.equal(r.json.total, 3); assert.equal(r.json.byStatus.IN_STOCK, 2); assert.equal(r.json.bookValue, 30000);
assert.equal((await call(tok('x', ['asset.manage'], 'c2'), 'GET', 'get', {}, { id })).status, 404);
assert.equal((await call(tok('x', ['asset.manage'], 'c2'), 'GET', 'list')).json.items.length, 0);
console.log('assets ok');
