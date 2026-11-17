import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLeave } from '../api/_lib/leaveApi.ts';
import { runAllReminders } from '../api/_lib/reminderApi.ts';
import { buildTeamWeek, basicIntro, dayLabel, quietWeek, weekFacts, weekStartFor, weeklyEmail } from '../shared/teamWeek.ts';

// ---------------------------------------------------------------- pure
const isOff = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
const M = (uid: string, ...reqs: [string, string, string?][]) => ({ uid, name: uid.toUpperCase(), isOff, requests: reqs.map(([from, to, status]) => ({ from, to, status: status || 'APPROVED' })) });
assert.equal(weekStartFor('2026-11-16'), '2026-11-16'); assert.equal(weekStartFor('2026-11-20'), '2026-11-16');
assert.equal(weekStartFor('2026-11-21'), '2026-11-23', 'a weekend looks at the coming week'); assert.equal(weekStartFor('2026-11-22'), '2026-11-23');
assert.equal(dayLabel('2026-11-18'), 'Wed 18 Nov');
const w = buildTeamWeek('2026-11-17', [
  M('a', ['2026-11-18', '2026-11-18']), M('b', ['2026-11-18', '2026-11-20']), M('c', ['2026-11-18', '2026-11-18']), M('d', ['2026-11-23', '2026-11-24', 'PENDING']), M('e'),
], [{ id: 'r1', name: 'D', typeName: 'Casual leave', from: '2026-11-23', to: '2026-11-24', days: 2, waitingDays: 3 }], 40);
assert.equal(w.size, 5); assert.deepEqual(w.thisWeek.map((p) => p.name), ['A', 'B', 'C']);
assert.deepEqual(w.thisWeek.find((p) => p.name === 'B')!.days, ['2026-11-18', '2026-11-19', '2026-11-20']);
assert.deepEqual(w.busiest, { day: '2026-11-18', away: 3 });
assert.deepEqual(w.overLimit, [{ day: '2026-11-18', away: 3 }], '3 of 5 is above 40%');
assert.equal(w.nextWeek[0].pending, true); assert.equal(w.waiting.length, 1);
assert.ok(weekFacts(w).includes('Wed 18 Nov with 3 of 5 away')); assert.ok(weekFacts(w).includes('waiting 3 days'));
assert.ok(basicIntro(w).startsWith('3 of 5 people have leave this week.'));
assert.equal(quietWeek(buildTeamWeek('2026-11-17', [M('a'), M('b')], [])), true);
assert.ok(weeklyEmail('Mira', w, 'Intro.').subject.includes('Mon 16 Nov'));
assert.deepEqual(buildTeamWeek('2026-11-17', [M('a', ['2026-11-21', '2026-11-22'])], []).thisWeek, [], 'weekends are not leave days');

// ---------------------------------------------------------------- server
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tok = (uid: string, perms: string[] = []) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid: CID, cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const HR = tok('u_hr', ['leave.manage', 'leave.report']), MGR = tok('u_mgr'), EMP = tok('u_a');
fdb.seed('companies', CID, { name: 'Acme', status: 'ACTIVE' });
for (const u of ['u_hr', 'u_mgr', 'u_a', 'u_b', 'u_c']) fdb.seed('employees', u, { companyId: CID, authUid: u, name: u, email: `${u}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops' });
const call = (h: any, method: string, action: string, body: any = {}) => routeLeave({ method, action, headers: h, body, query: {}, ip: '1.2.3.4' });
await call(HR, 'POST', 'apply-starter', { yearStartMonth: 4 });
await call(HR, 'POST', 'save-profiles', { profiles: ['u_a', 'u_b', 'u_c'].map((uid) => ({ uid, joinDate: '2020-01-01', managerUid: 'u_mgr' })).concat([{ uid: 'u_mgr', joinDate: '2019-01-01', managerUid: '' }] as any) });
const req = (id: string, uid: string, from: string, to: string, extra: any = {}) => fdb.seed('leaveRequests', id, {
  id, companyId: CID, uid, name: uid, typeName: 'Casual leave', from, to, days: 1, status: 'APPROVED', managerUid: 'u_mgr', createdAt: '2026-11-10T00:00:00Z', steps: [{ role: 'MANAGER' }], stepIndex: 0, ...extra,
});
req('r1', 'u_a', '2026-11-18', '2026-11-18'); req('r2', 'u_b', '2026-11-18', '2026-11-18'); req('r3', 'u_c', '2026-11-23', '2026-11-23', { status: 'PENDING', createdAt: '2026-11-12T00:00:00Z' });

const view = (await call(MGR, 'GET', 'team-week')).json;
assert.equal(view.success, true); assert.equal(view.team, true); assert.equal(view.week.size, 3);
assert.deepEqual(view.week.thisWeek.map((p: any) => p.name), ['u_a', 'u_b']);
assert.equal(view.week.waiting.length, 1); assert.equal(view.week.waiting[0].name, 'u_c');
assert.deepEqual(view.week.overLimit, [{ day: '2026-11-18', away: 2 }], '2 of 3 is above 40%');
assert.equal((await call(EMP, 'GET', 'team-week')).json.team, false, 'someone with no reports gets an empty page');
assert.equal(me(await call(MGR, 'GET', 'me')).isManager, true);
function me(r: any) { return r.json; }

// Monday email: once per week, only when there is something to say, never on other days
const note = (uid: string) => fdb.all('leaveNotifications').length; void note;
const sent = () => fdb.all('reminderLog').filter((r: any) => String(r.key).startsWith('teamweek:'));
delete process.env.OPENAI_API_KEY;
assert.equal((await runAllReminders('2026-11-18')).c1.teamWeek.emails, 0, 'Wednesday: no summary');
const mon = await runAllReminders('2026-11-16');
assert.equal(mon.c1.teamWeek.emails, 1); assert.equal(sent().length, 1); assert.equal(sent()[0].uid, 'u_mgr');
assert.equal((await runAllReminders('2026-11-16')).c1.teamWeek.emails, 0, 'running again the same Monday sends nothing');
assert.equal((await runAllReminders('2026-11-17')).c1.teamWeek.emails, 0, 'Tuesday after a Monday send: nothing again');
const nextMonday = await runAllReminders('2026-11-23');
assert.equal(nextMonday.c1.teamWeek.emails, 1, 'the next week gets its own');
console.log('team week tests passed');
