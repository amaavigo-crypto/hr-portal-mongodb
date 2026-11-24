import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routePrefixed } from '../api/_lib/prefixRouter.ts';
import { billableLines, cleanEntries, loggedHours, plannedLoad, rateFor, totals, weekDays, weekStart } from '../shared/psa.ts';

// ---- rules
assert.equal(weekStart('2026-11-24'), '2026-11-23'); assert.equal(weekStart('2026-11-22'), '2026-11-16'); assert.equal(weekStart('2026-11-23'), '2026-11-23');
assert.deepEqual(weekDays('2026-11-23').slice(0, 2), ['2026-11-23', '2026-11-24']);
const okP = new Set(['p1']);
assert.match(cleanEntries('2026-11-23', [{ projectId: 'zz', date: '2026-11-23', hours: 1 }], okP).error!, /not on/);
assert.match(cleanEntries('2026-11-23', [{ projectId: 'p1', date: '2026-12-01', hours: 1 }], okP).error!, /outside/);
assert.match(cleanEntries('2026-11-23', [{ projectId: 'p1', date: '2026-11-23', hours: 1.1 }], okP).error!, /15 minutes/);
assert.match(cleanEntries('2026-11-23', [{ projectId: 'p1', date: '2026-11-23', hours: 25 }], okP).error!, /0 and 24/);
assert.match(cleanEntries('2026-11-23', [{ projectId: 'p1', date: '2026-11-23', hours: 20 }, { projectId: 'p1', date: '2026-11-23', hours: 5 }], okP).error!, /more than 24/);
assert.deepEqual(cleanEntries('2026-11-23', [{ projectId: 'p1', date: '2026-11-23', hours: 2 }, { projectId: 'p1', date: '2026-11-23', hours: 1.5 }, { projectId: 'p1', date: '2026-11-24', hours: 0 }], okP).entries!.map((e) => e.hours), [3.5], 'same day merges, zero is dropped');
assert.equal(rateFor({ defaultRate: 1000, roleRates: { a: 1500 } }, 'a'), 1500); assert.equal(rateFor({ defaultRate: 1000 }, 'b'), 1000);
const P: any[] = [{ id: 'p1', clientId: 'c1', name: 'Web', billing: 'TM', billable: true, defaultRate: 1000, roleRates: { a: 1500 } }, { id: 'p2', clientId: 'c1', name: 'Internal', billing: 'TM', billable: false, defaultRate: 0 }, { id: 'p3', clientId: 'c2', name: 'Other', billing: 'TM', billable: true, defaultRate: 5 }];
const S = (id: string, uid: string, ws: string, status: string, entries: any[], invoiced: any = {}) => ({ id, uid, name: uid.toUpperCase(), weekStart: ws, status, entries, invoiced });
const sheets = [S('s1', 'a', '2026-11-16', 'APPROVED', [{ projectId: 'p1', date: '2026-11-16', hours: 8 }, { projectId: 'p2', date: '2026-11-17', hours: 4 }]), S('s2', 'b', '2026-11-16', 'APPROVED', [{ projectId: 'p1', date: '2026-11-16', hours: 2.5 }]), S('s3', 'a', '2026-11-23', 'SUBMITTED', [{ projectId: 'p1', date: '2026-11-23', hours: 8 }]), S('s4', 'b', '2026-11-23', 'APPROVED', [{ projectId: 'p1', date: '2026-11-23', hours: 1 }], { p1: 'inv' })];
const ls = billableLines(sheets as any, P, 'c1', '2026-11-16', '2026-11-30');
assert.deepEqual(ls.map((l) => [l.name, l.hours, l.rate, l.amount]), [['A', 8, 1500, 12000], ['B', 2.5, 1000, 2500]], 'approved only, billable only, not already invoiced');
assert.deepEqual(totals(ls, 18), { subtotal: 14500, tax: 2610, total: 17110 });
assert.deepEqual(plannedLoad([{ uid: 'a', projectId: 'p1', hoursPerWeek: 30, from: '2026-11-01', to: '2026-11-30' }, { uid: 'a', projectId: 'p2', hoursPerWeek: 15, from: '2026-11-20', to: '2026-12-31' }, { uid: 'b', projectId: 'p1', hoursPerWeek: 10, from: '2026-12-07', to: '2026-12-31' }], '2026-11-23'), [{ uid: 'a', planned: 45, capacity: 40, free: -5, over: true }]);
const lg = loggedHours(sheets as any, P); assert.deepEqual(lg.find((r) => r.uid === 'a'), { uid: 'a', name: 'A', billable: 16, other: 4, utilisation: 80 });

// ---- API
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const tok = (uid: string, perms: string[] = [], cid = 'c1') => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@a.com`, cid, cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const ADM = tok('adm', ['psa.manage']);
fdb.seed('companies', 'c1', { name: 'A' }); fdb.seed('companies', 'c2', { name: 'B' });
for (const uid of ['adm', 'dev', 'dev2', 'mgr', 'viewer', 'out']) fdb.seed('employees', uid, { companyId: 'c1', authUid: uid, name: `P ${uid}`, email: `${uid}@a.com`, active: true, createdAt: '2020-01-01T00:00:00Z' });
fdb.seed('leaveProfiles', 'c1__dev', { companyId: 'c1', uid: 'dev', managerUid: 'mgr' });
const call = async (h: any, method: string, action: string, body: any = {}, query: any = {}) => (await routePrefixed(`psa-${action}`, { method, query, body, headers: h }))!;

assert.equal((await call(tok('dev'), 'POST', 'save-client', { name: 'X' })).status, 403);
assert.equal((await call(ADM, 'POST', 'save-client', { name: '' })).status, 400);
const cid = (await call(ADM, 'POST', 'save-client', { name: 'Acme', gstin: '27abcde1234f1z5' })).json.id;
assert.equal((await call(ADM, 'GET', 'clients')).json.items[0].gstin, '27ABCDE1234F1Z5');
assert.equal((await call(ADM, 'POST', 'save-project', { name: 'Web', clientId: 'nope' })).status, 400);
const pid = (await call(ADM, 'POST', 'save-project', { name: 'Web', clientId: cid, code: 'web', defaultRate: 1000, roleRates: { dev: 1500, junk: 'x' }, billable: true })).json.id;
const fid = (await call(ADM, 'POST', 'save-project', { name: 'Brand', clientId: cid, billing: 'FIXED', fixedFee: 50000 })).json.id;
assert.equal((await call(tok('dev'), 'GET', 'projects')).json.items.length, 0, 'not allocated, sees nothing');
assert.equal((await call(ADM, 'POST', 'save-allocation', { projectId: pid, uid: 'ghost', hoursPerWeek: 10, from: '2026-11-01', to: '2026-12-31' })).status, 400);
assert.equal((await call(ADM, 'POST', 'save-allocation', { projectId: pid, uid: 'dev', hoursPerWeek: 10, from: '2026-12-01', to: '2026-11-01' })).status, 400);
await call(ADM, 'POST', 'save-allocation', { projectId: pid, uid: 'dev', hoursPerWeek: 30, from: '2026-11-01', to: '2026-12-31' });
await call(ADM, 'POST', 'save-allocation', { projectId: pid, uid: 'dev2', hoursPerWeek: 10, from: '2026-11-01', to: '2026-12-31' });
assert.equal((await call(tok('dev'), 'GET', 'projects')).json.items[0].name, 'Web'); assert.equal((await call(tok('dev'), 'GET', 'projects')).json.items[0].defaultRate, undefined, 'rates are hidden from staff');
assert.equal((await call(tok('dev'), 'GET', 'allocations')).status, 403);
assert.equal((await call(ADM, 'GET', 'load', {}, { weekStart: '2026-11-25' })).json.items.find((r: any) => r.uid === 'dev').planned, 30);

// timesheets
const W = '2026-11-23';
assert.equal((await call(tok('dev'), 'POST', 'save-sheet', { weekStart: W, entries: [{ projectId: fid, date: W, hours: 2 }] })).status, 400, 'only allocated projects');
assert.equal((await call(tok('dev'), 'POST', 'save-sheet', { weekStart: W, entries: [{ projectId: pid, date: '2026-11-24', hours: 8 }, { projectId: pid, date: '2026-11-25', hours: 4 }] })).status, 200);
assert.equal((await call(tok('dev'), 'POST', 'submit-sheet', { weekStart: '2026-11-30' })).status, 400, 'empty week');
assert.equal((await call(tok('dev'), 'POST', 'submit-sheet', { weekStart: '2026-11-26' })).status, 200, 'any day in the week names it');
assert.equal((await call(tok('dev'), 'POST', 'save-sheet', { weekStart: W, entries: [] })).status, 409, 'locked once sent');
assert.equal((await call(tok('out'), 'GET', 'queue')).json.items.length, 0); assert.equal((await call(tok('mgr'), 'GET', 'queue')).json.items.length, 1); assert.equal((await call(ADM, 'GET', 'queue')).json.items[0].hours, 12);
assert.equal((await call(tok('out'), 'GET', 'sheet', {}, { uid: 'dev', weekStart: W })).status, 403);
const sid = (await call(tok('mgr'), 'GET', 'queue')).json.items[0].id;
assert.equal((await call(tok('out'), 'POST', 'decide-sheet', { id: sid, approve: true })).status, 403);
assert.equal((await call(tok('mgr'), 'POST', 'decide-sheet', { id: sid, approve: false })).status, 400, 'reason needed');
assert.equal((await call(tok('mgr'), 'POST', 'decide-sheet', { id: sid, approve: false, note: 'Fix Tuesday' })).status, 200);
assert.equal((await call(tok('dev'), 'GET', 'sheet', {}, { weekStart: W })).json.sheet.decisionNote, 'Fix Tuesday');
assert.equal((await call(tok('dev'), 'POST', 'save-sheet', { weekStart: W, entries: [{ projectId: pid, date: '2026-11-24', hours: 8 }] })).status, 200, 'rejected weeks can be edited');
await call(tok('dev'), 'POST', 'submit-sheet', { weekStart: W });
assert.equal((await call(tok('mgr'), 'POST', 'decide-sheet', { id: sid, approve: true })).status, 200);
assert.equal((await call(tok('mgr'), 'POST', 'decide-sheet', { id: sid, approve: true })).status, 409);

// billing
const q = { clientId: cid, from: '2026-11-01', to: '2026-11-30' };
assert.equal((await call(tok('viewer', ['psa.view']), 'GET', 'billable', {}, q)).status, 403);
let b = await call(ADM, 'GET', 'billable', {}, q); assert.deepEqual(b.json.lines.map((l: any) => [l.hours, l.rate, l.amount]), [[8, 1500, 12000]]); assert.equal(b.json.fixed[0].remaining, 50000);
assert.equal((await call(ADM, 'POST', 'create-invoice', { ...q, clientId: 'nope' })).status, 400);
assert.equal((await call(ADM, 'POST', 'create-invoice', { ...q, fixed: [{ projectId: fid, amount: 60000 }] })).status, 400, 'over the fixed fee');
let inv = await call(ADM, 'POST', 'create-invoice', { ...q, taxPct: 18, fixed: [{ projectId: fid, amount: 20000 }] });
assert.equal(inv.status, 200); assert.match(inv.json.number, /^INV-\d{4}-0001$/); assert.deepEqual([inv.json.subtotal, inv.json.tax, inv.json.total], [32000, 5760, 37760]);
assert.equal((await call(ADM, 'POST', 'create-invoice', q)).status, 400, 'time is not billed twice');
assert.equal((await call(ADM, 'GET', 'billable', {}, q)).json.fixed[0].remaining, 30000);
assert.equal((await call(tok('viewer', ['psa.view']), 'GET', 'invoice', {}, { id: inv.json.id })).json.invoice.lines.length, 2);
assert.equal((await call(ADM, 'POST', 'invoice-status', { id: inv.json.id, status: 'PAID' })).status, 409, 'must be sent first');
assert.equal((await call(ADM, 'POST', 'invoice-status', { id: inv.json.id, status: 'VOID' })).status, 200);
b = await call(ADM, 'GET', 'billable', {}, q); assert.equal(b.json.lines.length, 1, 'voiding frees the time'); assert.equal(b.json.fixed[0].remaining, 50000, 'and the fixed fee');
assert.equal((await call(ADM, 'POST', 'invoice-status', { id: inv.json.id, status: 'SENT' })).status, 409, 'void is final');
inv = await call(ADM, 'POST', 'create-invoice', q); assert.match(inv.json.number, /0002$/);
await call(ADM, 'POST', 'invoice-status', { id: inv.json.id, status: 'SENT' }); assert.equal((await call(ADM, 'POST', 'invoice-status', { id: inv.json.id, status: 'PAID' })).status, 200);
assert.equal((await call(ADM, 'GET', 'invoices')).json.items.length, 2);
assert.deepEqual((await call(ADM, 'GET', 'utilisation', {}, q)).json.items.map((r: any) => [r.uid, r.billable]), [['dev', 8]]);
assert.equal((await call(tok('x', ['psa.manage'], 'c2'), 'GET', 'invoices')).json.items.length, 0, 'other companies see nothing');
console.log('psa ok');
