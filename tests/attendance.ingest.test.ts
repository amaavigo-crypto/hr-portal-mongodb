import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLeave } from '../api/_lib/leaveApi.ts';
import { dayFields, groupPunches, mergePunches, parseCsv, parseDir, parseJson, parseWhen } from '../shared/attendanceIngest.ts';

// ---- parsing
assert.equal(parseWhen('2026-11-03 09:12'), '2026-11-03T03:42:00.000Z', 'no zone = IST');
assert.equal(parseWhen('2026-11-03T09:12:00+05:30'), '2026-11-03T03:42:00.000Z');
assert.equal(parseWhen('2026-11-03T03:42:00Z'), '2026-11-03T03:42:00.000Z');
assert.equal(parseWhen('03/11/2026 09:12'), '2026-11-03T03:42:00.000Z', 'day first');
assert.equal(parseWhen('03/11/2026 06:05 PM'), '2026-11-03T12:35:00.000Z');
assert.equal(parseWhen('2026-02-31 09:00'), ''); assert.equal(parseWhen('nonsense'), ''); assert.equal(parseWhen(''), '');
assert.equal(parseDir('In'), 'IN'); assert.equal(parseDir('check-out'), 'OUT'); assert.equal(parseDir('7'), '');

const csv = parseCsv('﻿Employee ID,Date,Time,Direction\nE001,2026-11-03,09:12,IN\n"E002",03/11/2026,18:00,\n,2026-11-03,10:00,IN\nE003,bad,10:00,IN\n');
assert.equal(csv.punches.length, 2); assert.equal(csv.problems.length, 2);
assert.equal(csv.punches[0].dir, 'IN'); assert.equal(csv.punches[1].dir, '');
assert.match(parseCsv('a,b\n1,2').problems[0], /employee id column/);
assert.equal(parseJson([{ employeeId: 'E1', timestamp: '2026-11-03 09:00', type: 'out' }, { empId: 'E2' }]).punches[0].dir, 'OUT');
assert.equal(parseJson('x' as any).punches.length, 0);

// ---- merging
const P = (t: string, dir: any = '') => ({ at: parseWhen(`2026-11-03 ${t}`), dir });
let r = mergePunches([], [P('09:00'), P('13:00'), P('14:00'), P('18:30')]);
assert.equal(r.sessions.length, 2, 'unmarked punches pair in order');
assert.equal(r.sessions[0].out, P('13:00').at); assert.equal(dayFields(r.sessions).checkOut, P('18:30').at);
r = mergePunches([], [P('09:00'), P('09:01')]);
assert.equal(r.sessions.length, 1); assert.equal(r.sessions[0].out ?? null, null, 'a double scan is one punch'); assert.equal(r.ignored, 1);
r = mergePunches([], [P('09:00'), P('18:00')]);
const again = mergePunches(r.sessions, [P('09:00'), P('18:00')]);
assert.equal(again.added, 0, 'applying twice changes nothing'); assert.deepEqual(again.sessions, r.sessions);
r = mergePunches([{ in: P('09:00').at, out: null, inNote: 'wfh' }], [P('17:45')]);
assert.equal(r.sessions[0].out, P('17:45').at); assert.equal(r.sessions[0].inNote, 'wfh', 'existing notes kept');
r = mergePunches([], [P('18:00', 'OUT')]); assert.equal(r.sessions.length, 0, 'an out with no in is dropped'); assert.equal(r.ignored, 1);
r = mergePunches([], [P('09:00', 'IN'), P('10:00', 'IN'), P('12:00', 'OUT')]);
assert.equal(r.sessions.length, 1, 'second IN while in is ignored'); assert.equal(r.sessions[0].out, P('12:00').at);
const many = mergePunches([], Array.from({ length: 40 }, (_, i) => P(`${String(Math.floor(i / 2) + 1).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)));
assert.ok(many.sessions.length <= 12);
r = mergePunches([{ in: P('09:00').at, out: P('18:00').at }], [P('12:00')]);
assert.equal(r.added, 0, 'a punch inside a finished session adds nothing'); assert.equal(r.sessions.length, 1);
// day grouping uses IST: 23:30 IST is still that day
const g = groupPunches([{ empId: 'E1', at: parseWhen('2026-11-03 23:30'), dir: '' }, { empId: 'e1', at: parseWhen('2026-11-04 00:10'), dir: '' }]);
assert.deepEqual([...g.get('e1')!.keys()], ['2026-11-03', '2026-11-04']);

// ---- API
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const tok = (uid: string, perms: string[] = [], cid = 'c1') => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@a.com`, cid, cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const HR = tok('hr', ['leave.manage']), EMP = tok('u1');
fdb.seed('companies', 'c1', { name: 'A' }); fdb.seed('companies', 'c2', { name: 'B' });
fdb.seed('employees', 'u1', { companyId: 'c1', authUid: 'u1', name: 'Asha', email: 'u1@a.com', active: true, empId: 'E001', createdAt: '2020-01-01T00:00:00Z' });
fdb.seed('employees', 'u9', { companyId: 'c2', authUid: 'u9', name: 'Other', email: 'u9@a.com', active: true, empId: 'E009', createdAt: '2020-01-01T00:00:00Z' });
const call = (headers: any, method: string, action: string, body: any = {}, query: any = {}) => routeLeave({ method, action, headers, body, query, ip: '1.1.1.1' });

assert.equal((await call(EMP, 'POST', 'create-attendance-key', { label: 'x' })).status, 403, 'employees cannot make keys');
assert.equal((await call(EMP, 'POST', 'attendance-import', { csv: 'x' })).status, 403);
assert.equal((await call({}, 'POST', 'attendance-ingest', { logs: [] })).status, 401, 'no key');
assert.equal((await call({ 'x-api-key': 'atk_' + 'a'.repeat(48) }, 'POST', 'attendance-ingest', { logs: [] })).status, 401, 'unknown key');
assert.equal((await call(HR, 'POST', 'create-attendance-key', { label: '' })).status, 400);

const made = await call(HR, 'POST', 'create-attendance-key', { label: 'Turnstile' });
assert.equal(made.status, 200); const KEY = made.json.key; assert.match(KEY, /^atk_[a-f0-9]{48}$/);
assert.equal((await fdb.collection('attendanceApiKeys').doc(KEY).get()).exists, false, 'the key itself is never the document id');
const listed = (await call(HR, 'GET', 'attendance-keys')).json.items;
assert.equal(listed.length, 1); assert.equal(listed[0].prefix, KEY.slice(0, 8)); assert.equal(listed[0].lastUsedAt, '');

const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const old = new Date(Date.now() + 5.5 * 3600_000 - 90 * 86400_000).toISOString().slice(0, 10);
let res = await call({ 'x-api-key': KEY }, 'POST', 'attendance-ingest', { logs: [
  { empId: 'E001', time: `${today} 09:00`, direction: 'IN' }, { empId: 'e001', time: `${today} 18:00`, direction: 'OUT' },
  { empId: 'E404', time: `${today} 09:00` }, { empId: 'E009', time: `${today} 09:00` }, { empId: 'E001', time: `${old} 09:00` },
] });
assert.equal(res.status, 200, JSON.stringify(res.json));
assert.equal(res.json.added, 2); assert.equal(res.json.daysUpdated, 1);
assert.deepEqual(res.json.unknownEmployees.sort(), ['e009', 'e404'], "another company's employee ids are unknown here");
assert.ok(res.json.problems.some((p: string) => /62 days/.test(p)));
const day: any = (await fdb.collection('leaveAttendance').doc(`c1__u1__${today}`).get()).data();
assert.equal(day.sessions.length, 1); assert.equal(day.source, 'DEVICE'); assert.equal(day.month, today.slice(0, 7)); assert.ok(day.checkOut);
assert.equal((await fdb.collection('leaveAttendance').doc(`c2__u9__${today}`).get()).exists, false);

res = await call({ 'x-api-key': KEY }, 'POST', 'attendance-ingest', { logs: [{ empId: 'E001', time: `${today} 09:00`, direction: 'IN' }] });
assert.equal(res.json.added, 0, 'resending is harmless');
assert.equal((await call({ 'x-api-key': KEY }, 'POST', 'attendance-ingest', { logs: [{ foo: 1 }] })).status, 400);
assert.equal((await call({ 'x-api-key': KEY }, 'GET', 'attendance-ingest')).status, 405);
assert.ok((await call(HR, 'GET', 'attendance-keys')).json.items[0].lastUsedAt);

const imp = await call(HR, 'POST', 'attendance-import', { csv: `Employee ID,Date Time\nE001,${today} 09:30\nE001,${today} 19:00\n` });
assert.equal(imp.status, 200); assert.equal(imp.json.added, 1, '09:30 falls inside the 09:00-18:00 session and is ignored; 19:00 opens a new one'); assert.equal(imp.json.ignored, 1);
assert.equal((await call(HR, 'POST', 'attendance-import', { csv: '' })).status, 400);

const id = listed[0].id;
assert.equal((await call(tok('hr2', ['leave.manage'], 'c2'), 'POST', 'revoke-attendance-key', { id })).status, 404, 'another company cannot revoke it');
assert.equal((await call(HR, 'POST', 'revoke-attendance-key', { id })).status, 200);
assert.equal((await call({ 'x-api-key': KEY }, 'POST', 'attendance-ingest', { logs: [{ empId: 'E001', time: `${today} 20:00` }] })).status, 401, 'revoked key stops working');
console.log('attendance.ingest ok');
