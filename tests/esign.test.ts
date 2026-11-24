import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routePrefixed } from '../api/_lib/prefixRouter.ts';
import { canSignNow, nameMatches, statusOf, whoseTurn, type Signer } from '../shared/esign.ts';

// ---- rules
assert.equal(nameMatches('Asha Rao', 'Asha Rao'), true); assert.equal(nameMatches('asha  k. RAO', 'Asha Rao'), true);
assert.equal(nameMatches('Asha', 'Asha Rao'), false); assert.equal(nameMatches('Rao Asha', 'Asha Rao'), false); assert.equal(nameMatches('', 'Asha'), false);
const S = (uid: string, order: number, status: any = 'PENDING'): Signer => ({ uid, name: uid, email: '', order, status });
const req = (signers: Signer[], over: any = {}) => ({ status: 'PENDING' as const, ordered: false, expiresAt: new Date(Date.now() + 1e9).toISOString(), signers, ...over });
assert.equal(statusOf(req([S('a', 1, 'SIGNED'), S('b', 2, 'SIGNED')])), 'COMPLETED');
assert.equal(statusOf(req([S('a', 1, 'SIGNED'), S('b', 2, 'DECLINED')])), 'DECLINED');
assert.equal(statusOf(req([S('a', 1)], { expiresAt: '2020-01-01T00:00:00Z' })), 'EXPIRED');
assert.equal(statusOf(req([S('a', 1, 'SIGNED')], { status: 'CANCELLED' })), 'CANCELLED');
assert.equal(statusOf(req([])), 'PENDING', 'no signers is never complete');
const ord = req([S('a', 1), S('b', 2), S('c', 3)], { ordered: true });
assert.equal(canSignNow(ord, 'a').ok, true); assert.equal(canSignNow(ord, 'b').ok, false); assert.match(canSignNow(ord, 'c').reason!, /a, b/);
assert.equal(canSignNow(ord, 'zz').ok, false);
assert.deepEqual(whoseTurn(ord).map((s) => s.uid), ['a']); assert.equal(whoseTurn(req([S('a', 1), S('b', 2)])).length, 2);
assert.equal(canSignNow(req([S('a', 1, 'SIGNED')]), 'a').ok, false);

// ---- API
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const tok = (uid: string, perms: string[] = [], cid = 'c1') => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@a.com`, cid, cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const HR = tok('hr', ['esign.manage']);
fdb.seed('companies', 'c1', { name: 'A' }); fdb.seed('companies', 'c2', { name: 'B' });
for (const [uid, name] of [['hr', 'Hema Rao'], ['u1', 'Asha Kulkarni'], ['u2', 'Bela Shah'], ['u3', 'Chetan Mehta']]) fdb.seed('employees', uid, { companyId: 'c1', authUid: uid, name, email: `${uid}@a.com`, active: true, createdAt: '2020-01-01T00:00:00Z' });
fdb.seed('employees', 'x1', { companyId: 'c2', authUid: 'x1', name: 'Other Co', email: 'x1@a.com', active: true, createdAt: '2020-01-01T00:00:00Z' });
const call = async (h: any, method: string, action: string, body: any = {}, query: any = {}) => (await routePrefixed(`esign-${action}`, { method, query, body, headers: h, ip: '9.9.9.9' }))!;

assert.equal((await call(tok('u1'), 'POST', 'create', { title: 't', body: 'b', signerUids: ['u1'] })).status, 403, 'employees cannot send documents');
assert.equal((await call(HR, 'POST', 'create', { title: '', body: 'b', signerUids: ['u1'] })).status, 400);
assert.equal((await call(HR, 'POST', 'create', { title: 't', body: 'b', signerUids: [] })).status, 400);
assert.equal((await call(HR, 'POST', 'create', { title: 't', body: 'b', signerUids: ['x1'] })).status, 400, 'a signer from another company is refused');
assert.equal((await call(HR, 'POST', 'create', { title: 't', body: 'x'.repeat(60001), signerUids: ['u1'] })).status, 400);

let r = await call(HR, 'POST', 'create', { title: 'NDA', body: 'You agree to keep things confidential.', signerUids: ['u1', 'u2'], ordered: true });
assert.equal(r.status, 200, JSON.stringify(r.json)); const id = r.json.id;
const U1 = tok('u1'), U2 = tok('u2'), U3 = tok('u3');
assert.equal((await call(U1, 'GET', 'mine')).json.toSign.length, 1);
assert.equal((await call(U2, 'GET', 'mine')).json.toSign.length, 0, 'second signer waits');
assert.equal((await call(U2, 'GET', 'mine')).json.waiting.length, 1);
assert.equal((await call(U3, 'GET', 'get', {}, { id })).status, 404, 'outsiders cannot open it');
assert.equal((await call(U2, 'POST', 'sign', { id, typedName: 'Bela Shah', consent: true })).status, 409, 'out of order');
assert.equal((await call(U1, 'POST', 'sign', { id, typedName: 'Asha Kulkarni', consent: false })).status, 400, 'consent needed');
assert.equal((await call(U1, 'POST', 'sign', { id, typedName: 'Someone Else', consent: true })).status, 400, 'name must match');
assert.equal((await call(U1, 'POST', 'sign', { id, typedName: 'Asha Kulkarni', consent: true })).status, 200);
assert.equal((await call(U1, 'POST', 'sign', { id, typedName: 'Asha Kulkarni', consent: true })).status, 409, 'cannot sign twice');
assert.equal((await call(U2, 'GET', 'mine')).json.toSign.length, 1, 'now it is their turn');
r = await call(U2, 'GET', 'get', {}, { id }); assert.equal(r.json.certificate, null); assert.equal(r.json.canSign.ok, true);
assert.equal((await call(U2, 'POST', 'sign', { id, typedName: 'bela shah', consent: true })).status, 200);
r = await call(HR, 'GET', 'get', {}, { id });
assert.equal(r.json.request.status, 'COMPLETED'); assert.equal(r.json.certificate.signatures.length, 2);
assert.equal(r.json.certificate.signatures[0].ip, '9.9.9.9'); assert.match(r.json.certificate.documentHash, /^[a-f0-9]{64}$/);
assert.deepEqual(r.json.request.events.map((e: any) => e.action), ['CREATED', 'SIGNED', 'SIGNED', 'COMPLETED']);
assert.equal((await call(HR, 'GET', 'verify', {}, { id })).json.intact, true);
assert.equal((await call(HR, 'POST', 'cancel', { id })).status, 409, 'completed cannot be cancelled');

// tampering is caught
await fdb.collection('esignRequests').doc(id).set({ body: 'You agree to something else.' }, { merge: true });
assert.equal((await call(HR, 'GET', 'verify', {}, { id })).json.intact, false);

// decline and cancel
r = await call(HR, 'POST', 'create', { title: 'Policy', body: 'text', signerUids: ['u1', 'u3'] }); const id2 = r.json.id;
assert.equal((await call(U3, 'POST', 'decline', { id: id2, reason: '' })).status, 400);
assert.equal((await call(U3, 'POST', 'decline', { id: id2, reason: 'Not agreed' })).status, 200);
assert.equal((await call(HR, 'GET', 'get', {}, { id: id2 })).json.request.status, 'DECLINED');
assert.equal((await call(U1, 'POST', 'sign', { id: id2, typedName: 'Asha Kulkarni', consent: true })).status, 409, 'a declined request cannot be signed');
r = await call(HR, 'POST', 'create', { title: 'Old', body: 'text', signerUids: ['u1'], expiresInDays: 1 }); const id3 = r.json.id;
assert.equal((await call(U1, 'POST', 'cancel', { id: id3 })).status, 403, 'a signer cannot cancel');
assert.equal((await call(HR, 'POST', 'cancel', { id: id3 })).status, 200);
await fdb.collection('esignRequests').doc(id3).set({ status: 'PENDING', expiresAt: '2020-01-01T00:00:00Z' }, { merge: true });
assert.equal((await call(U1, 'POST', 'sign', { id: id3, typedName: 'Asha Kulkarni', consent: true })).status, 409, 'expired');
assert.equal((await call(HR, 'GET', 'all')).json.items.length, 3);
assert.equal((await call(U1, 'GET', 'all')).status, 403);
assert.equal((await call(tok('hr2', ['esign.manage'], 'c2'), 'GET', 'get', {}, { id })).status, 404, 'other company sees nothing');
console.log('esign ok');
