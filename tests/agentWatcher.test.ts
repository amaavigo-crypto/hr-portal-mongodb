import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLeave } from '../api/_lib/leaveApi.ts';
import { routeAssistant } from '../api/_lib/assistantApi.ts';
import { raiseException } from '../api/_lib/leaveCore.ts';
import { runWatcher } from '../api/_lib/agentWatcher.ts';
import { istToday, weekday } from '../shared/leaveEngine.ts';
import { addDays } from '../shared/leaveAgentTools.ts';
import { WATCH_EXIT_WINDOW_DAYS, WATCH_WAIT_DAYS, buildDigests, emailBody, type WatchInput } from '../shared/agentWatcher.ts';

// ------------------------------------------------------------------ pure parts

const T = '2026-11-24';
const people = [
  { uid: 'hr', name: 'Hema HR', email: 'hr@acme.com' }, { uid: 'mgr', name: 'Mira Manager', email: 'mgr@acme.com' }, { uid: 'mgr2', name: 'Manu Two', email: 'mgr2@acme.com' },
  { uid: 'emp', name: 'Esha Employee', email: 'emp@acme.com' }, { uid: 'new', name: 'Nia New', email: 'new@acme.com' }, { uid: 'calm', name: 'Cal Calm', email: 'calm@acme.com' },
];
const base = (over: Partial<WatchInput> = {}): WatchInput => ({ today: T, people, hrUids: ['hr'], leaves: [], exceptions: [], exits: [], tasks: [], ...over });
const leaveWaiting = (days: number, over: any = {}) => ({ name: 'Esha Employee', typeName: 'Casual leave', from: '2026-12-01', to: '2026-12-02', createdDay: addDays(T, -days), stage: 'MANAGER', managerUid: 'mgr', ...over });
const digestOf = (ds: ReturnType<typeof buildDigests>, uid: string) => ds.find((d) => d.uid === uid);

assert.equal(WATCH_WAIT_DAYS, 2);
assert.deepEqual(buildDigests(base()), [], 'nothing stuck: nobody is messaged');

// managers: waiting MORE than 2 days, their own queue only, manager stage only
let ds = buildDigests(base({ leaves: [leaveWaiting(2), leaveWaiting(3, { name: 'Three Days' }), leaveWaiting(9, { name: 'Nine Days' }), leaveWaiting(5, { stage: 'HR', name: 'At HR' }), leaveWaiting(5, { managerUid: 'mgr2', name: 'Other Team' }), leaveWaiting(5, { managerUid: '', name: 'No Manager' })] }));
const mg = digestOf(ds, 'mgr')!;
assert.equal(mg.sections.length, 1);
assert.deepEqual(mg.sections[0].lines.map((l) => l.split(':')[0]), ['Nine Days', 'Three Days'], 'two days is not enough; longest wait first');
assert.match(mg.sections[0].lines[0], /Casual leave, 2026-12-01 to 2026-12-02, waiting 9 days/);
assert.equal(digestOf(ds, 'mgr2')!.sections[0].lines.length, 1, 'another manager sees only their own');
assert.equal(digestOf(ds, 'hr'), undefined, 'a request waiting at the HR step is not a manager nudge, and the leave cron already escalates it');
assert.equal(digestOf(ds, 'emp'), undefined, 'the requester is not nudged');
assert.equal(mg.count, 2);
assert.equal(mg.title, 'Ask HR: 2 things need your attention');
assert.equal(digestOf(ds, 'mgr2')!.title, 'Ask HR: 1 thing needs your attention');

// long lists are cut, never dumped
ds = buildDigests(base({ leaves: Array.from({ length: 9 }, (_, i) => leaveWaiting(3 + i, { name: `P${i}` })) }));
assert.equal(digestOf(ds, 'mgr')!.sections[0].lines.length, 7);
assert.equal(digestOf(ds, 'mgr')!.sections[0].lines[6], 'and 3 more');
assert.match(digestOf(ds, 'mgr')!.sections[0].heading, /\(9\)/, 'the heading still says how many there really are');

// HR: attendance exceptions only, exits running out of time, overdue tasks
ds = buildDigests(base({
  exceptions: [
    { category: 'FLAG_LATE', employee: 'Omar Other', message: 'Late 4 times this month', severity: 'MEDIUM', createdDay: '2026-11-20' },
    { category: 'ATTENDANCE_MISMATCH', employee: 'Esha Employee', message: 'Approved leave on 2026-11-18 but checked in', severity: 'HIGH', createdDay: '2026-11-22' },
    { category: 'NO_POLICY', employee: 'Nia New', message: 'No policy', severity: 'HIGH', createdDay: '2026-11-01' },
    { category: 'FLAG_PAYROLL', employee: 'Nia New', message: 'Pay jumped', severity: 'HIGH', createdDay: '2026-11-01' },
  ],
  exits: [
    { name: 'Soon Leaver', lastWorkingDay: addDays(T, 3), pendingDepts: ['IT', 'Finance'] },
    { name: 'Gone Leaver', lastWorkingDay: addDays(T, -2), pendingDepts: ['Admin'] },
    { name: 'Edge Leaver', lastWorkingDay: addDays(T, WATCH_EXIT_WINDOW_DAYS), pendingDepts: ['IT'] },
    { name: 'Far Leaver', lastWorkingDay: addDays(T, WATCH_EXIT_WINDOW_DAYS + 1), pendingDepts: ['IT'] },
    { name: 'Done Leaver', lastWorkingDay: addDays(T, 1), pendingDepts: [] },
  ],
  tasks: [
    { title: 'Laptop', forUid: 'new', forName: 'Nia New', assigneeUid: '', assignee: 'IT', dueDate: addDays(T, -3) },
    { title: 'Welcome call', forUid: 'new', forName: 'Nia New', assigneeUid: '', assignee: 'HR', dueDate: T },
  ],
}));
const h = digestOf(ds, 'hr')!;
assert.deepEqual(h.sections.map((s) => s.heading), ['Open attendance exceptions (2)', 'Exit clearance running out of time (3)', 'Overdue onboarding task (1)']);
assert.match(h.sections[0].lines[0], /^Esha Employee: Approved leave on 2026-11-18/, 'the severe one first');
assert.ok(h.sections[0].lines.every((l) => !/No policy|Pay jumped/.test(l)), 'only attendance exceptions; payroll flags never go in a message');
assert.deepEqual(h.sections[1].lines.map((l) => l.split(':')[0]), ['Gone Leaver', 'Soon Leaver', 'Edge Leaver']);
assert.match(h.sections[1].lines[0], /last working day 2026-11-22 \(passed\), still pending: Admin/);
assert.match(h.sections[1].lines[1], /still pending: IT, Finance/);
assert.equal(h.sections[2].lines.length, 1, 'a task due today is not overdue');
assert.equal(h.count, 6);
for (const uid of ['mgr', 'emp', 'calm']) assert.equal(digestOf(ds, uid), undefined, `${uid} is not HR and has nothing of their own`);

// everyone: only their own overdue tasks; a task given to a manager shows who it is for; HR is not told twice
ds = buildDigests(base({
  tasks: [
    { title: 'Bank details', forUid: 'new', forName: 'Nia New', assigneeUid: 'new', assignee: 'EMPLOYEE', dueDate: addDays(T, -1) },
    { title: 'Sign policy', forUid: 'new', forName: 'Nia New', assigneeUid: '', assignee: 'EMPLOYEE', dueDate: addDays(T, -4) },
    { title: 'Buddy intro', forUid: 'new', forName: 'Nia New', assigneeUid: 'mgr', assignee: 'MANAGER', dueDate: addDays(T, -2) },
    { title: 'Not yet', forUid: 'new', forName: 'Nia New', assigneeUid: 'new', assignee: 'EMPLOYEE', dueDate: addDays(T, 2) },
    { title: 'Mine too', forUid: 'hr', forName: 'Hema HR', assigneeUid: 'hr', assignee: 'EMPLOYEE', dueDate: addDays(T, -2) },
  ],
}));
assert.deepEqual(digestOf(ds, 'new')!.sections[0].lines, ['Sign policy, due 2026-11-20', 'Bank details, due 2026-11-23'], 'oldest first, only the overdue ones');
assert.deepEqual(digestOf(ds, 'mgr')!.sections[0].lines, ['Buddy intro (for Nia New), due 2026-11-22']);
assert.equal(digestOf(ds, 'hr')!.sections.length, 1, 'HR gets the company-wide list only, not a second personal one');
assert.equal(digestOf(ds, 'hr')!.sections[0].heading, 'Overdue onboarding tasks (4)');

// a person who is manager and HR and has a task gets ONE message
ds = buildDigests(base({ hrUids: ['mgr'], leaves: [leaveWaiting(4)], tasks: [{ title: 'Laptop', forUid: 'new', forName: 'Nia New', assigneeUid: '', assignee: 'IT', dueDate: addDays(T, -1) }] }));
assert.equal(ds.length, 1);
assert.equal(ds[0].sections.length, 2);
assert.equal(ds[0].count, 2);

// people who are not in the active list are never messaged
ds = buildDigests(base({ people: people.filter((p) => p.uid !== 'mgr'), leaves: [leaveWaiting(5)] }));
assert.equal(digestOf(ds, 'mgr'), undefined);

const mail = emailBody(buildDigests(base({ leaves: [leaveWaiting(5)] }))[0], 'Acme Ltd', 'https://hr.acme.com');
assert.match(mail, /^Good morning Mira,/);
assert.match(mail, /waiting at Acme Ltd today/);
assert.match(mail, /- Esha Employee: Casual leave/);
assert.match(mail, /https:\/\/hr\.acme\.com/);

// ------------------------------------------------------------------ end to end: the cron route, delivery, once a day

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const tokenFor = (uid: string, perms: string[] = [], cid = 'c1') =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const HR = tokenFor('u_hr', ['leave.manage', 'leave.report']);
const EMP = tokenFor('u_emp');
const MGR = tokenFor('u_mgr');
const NEW = tokenFor('u_new');

fdb.seed('companies', 'c1', { name: 'Acme Ltd', status: 'ACTIVE' });
fdb.seed('companies', 'c2', { name: 'Other Ltd', status: 'ACTIVE' });
fdb.seed('companies', 'c3', { name: 'Closed Ltd', status: 'SUSPENDED' });
for (const [uid, name, active] of [['u_hr', 'Hema HR', true], ['u_mgr', 'Mira Manager', true], ['u_emp', 'Esha Employee', true], ['u_new', 'Nia New', true], ['u_other', 'Omar Other', true], ['u_gone', 'Gina Gone', false]] as const) {
  fdb.seed('employees', uid, { companyId: 'c1', authUid: uid, name, email: `${uid}@acme.com`, active, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops' });
}
fdb.seed('employees', 'u_c2', { companyId: 'c2', authUid: 'u_c2', name: 'Cora Other', email: 'u_c2@other.com', active: true, createdAt: '2020-01-01T00:00:00Z' });
const leave = async (headers: any, method: string, action: string, body: any = {}, query: any = {}) => routeLeave({ method, action, headers, body, query, ip: '1.2.3.4' });
assert.equal((await leave(HR, 'POST', 'apply-starter', { yearStartMonth: 4 })).status, 200);
await leave(HR, 'POST', 'save-profiles', { profiles: [{ uid: 'u_emp', managerUid: 'u_mgr', joinDate: '2020-01-01' }, { uid: 'u_mgr', joinDate: '2020-01-01' }, { uid: 'u_hr', joinDate: '2020-01-01' }, { uid: 'u_new', joinDate: '2020-01-01' }, { uid: 'u_other', joinDate: '2020-01-01' }] });
await leave(HR, 'POST', 'run-accrual');
// HR is whoever the Leave setup lists as the HR mailbox
const st = (await leave(HR, 'GET', 'settings')).json.settings;
assert.equal((await leave(HR, 'POST', 'save-settings', { settings: { ...st, notifyEmails: ['u_hr@acme.com'] } })).status, 200);

const today = istToday();
const wed = (() => { let d = addDays(today, 21); while (weekday(d) !== 3) d = addDays(d, 1); return d; })();
const applied = await leave(EMP, 'POST', 'apply', { typeId: 'cl', from: wed, to: wed, reason: 'Family function' });
assert.equal(applied.status, 200, JSON.stringify(applied.json));
const reqDoc = (await leave(HR, 'GET', 'all-requests', {}, { uid: 'u_emp' })).json.items[0];
await fdb.collection('leaveRequests').doc(reqDoc.id).update({ createdAt: `${addDays(today, -4)}T09:00:00.000Z` });
await raiseException('c1', { category: 'ATTENDANCE_MISMATCH', severity: 'HIGH', message: 'Omar Other has approved Casual leave on 2026-11-18 but also checked in that day.', uid: 'u_other' });
await raiseException('c1', { category: 'NO_POLICY', message: 'Somebody has no policy.', uid: 'u_new' });
fdb.seed('lifecycleExits', 'c1__u_other', { companyId: 'c1', uid: 'u_other', status: 'APPROVED', lastWorkingDay: addDays(today, 3), clearance: [{ deptId: 'it', label: 'IT', status: 'PENDING' }, { deptId: 'fin', label: 'Finance', status: 'CLEARED' }] });
const task = (id: string, over: any) => fdb.seed('lifecycleTasks', id, { companyId: 'c1', uid: 'u_new', title: 'Task', assignee: 'EMPLOYEE', assigneeUid: 'u_new', dueDate: addDays(today, -2), status: 'OPEN', ...over });
task('t1', { title: 'Bank details' });
task('t2', { title: 'Buddy intro', assignee: 'MANAGER', assigneeUid: 'u_mgr', dueDate: addDays(today, -1) });
task('t3', { title: 'Future task', dueDate: addDays(today, 5) });
task('t4', { title: 'Finished task', status: 'DONE' });
task('t5', { title: 'Gone person task', uid: 'u_gone', assigneeUid: 'u_gone' });
fdb.seed('lifecycleTasks', 'tc2', { companyId: 'c2', uid: 'u_c2', title: 'Other company task', assignee: 'EMPLOYEE', assigneeUid: 'u_c2', dueDate: addDays(today, -9), status: 'OPEN' });

// a dry run shows what would go out and writes nothing
const dry = await runWatcher('c1', { dry: true });
const to = (dry.preview || []).map((p) => p.to).sort();
assert.deepEqual(to, ['u_hr@acme.com', 'u_mgr@acme.com', 'u_new@acme.com'], 'HR, the manager and the joiner; not the requester, not the leaver, not the inactive person');
assert.equal((await fdb.collection('agentWatchLog').get()).docs.length, 0, 'a dry run saves nothing');
assert.equal((await fdb.collection('leaveNotifications').get()).docs.filter((d: any) => /Ask HR/.test(d.data().title)).length, 0);
const hrSections = dry.preview!.find((p) => p.to === 'u_hr@acme.com')!.sections;
assert.deepEqual(hrSections.map((s) => s.heading), ['Open attendance exception (1)', 'Exit clearance running out of time (1)', 'Overdue onboarding tasks (2)', 'Incomplete employee records (5)'], 'the NO_POLICY exception, the inactive person\'s task and the closed company are not in it');
assert.ok(!JSON.stringify(dry).includes('Cora') && !JSON.stringify(dry).includes('Other company task'), 'another company never leaks in');
const mgrSections = dry.preview!.find((p) => p.to === 'u_mgr@acme.com')!.sections;
assert.match(mgrSections[0].lines[0], /^Esha Employee: Casual leave, .*waiting 4 days/);
assert.match(mgrSections[1].lines[0], /^Buddy intro \(for Nia New\)/);

// the cron route: key rules
const cron = (query: any = {}, headers: any = {}) => routeAssistant({ method: 'GET', action: 'daily', query, body: {}, headers });
delete process.env.CRON_SECRET;
assert.equal((await cron({ key: 'x' })).status, 503, 'no secret configured: closed');
process.env.CRON_SECRET = 'cron-secret';
assert.equal((await cron()).status, 401);
assert.equal((await cron({ key: 'wrong' })).status, 401);
assert.equal((await cron({}, HR)).status, 401, 'a signed-in HR user is not the cron');
assert.equal((await fdb.collection('agentWatchLog').get()).docs.length, 0, 'refused calls did nothing');
assert.equal((await cron({ key: 'cron-secret', dry: '1' })).json.companies, 2, 'only active companies');
assert.equal((await fdb.collection('agentWatchLog').get()).docs.length, 0);

// the real run, with the key in the query, then in a header
const first = await cron({ key: 'cron-secret' });
assert.equal(first.status, 200);
assert.deepEqual([first.json.results.c1.sent, first.json.results.c1.alreadySent], [3, 0], JSON.stringify(first.json));
assert.equal(first.json.results.c2.sent, 1, 'company 2 is handled on its own: its one joiner with an overdue task');
assert.equal(first.json.results.c3, undefined, 'a suspended company is skipped');

// delivered in the app: the bell and the log
const bell = async (headers: any) => (await leave(headers, 'GET', 'notifications')).json.items.filter((n: any) => /^Ask HR:/.test(n.title));
assert.equal((await bell(MGR)).length, 1);
assert.equal((await bell(NEW)).length, 1);
assert.equal((await bell(HR)).length, 1);
assert.equal((await bell(EMP)).length, 0, 'the requester has nothing to be told');
assert.match((await bell(MGR))[0].title, /2 things need your attention/);
assert.equal((await fdb.collection('agentWatchLog').get()).docs.length, 4, 'one log entry per person messaged (3 in c1, 1 in c2)');

// running it again the same day sends nothing again, in any channel
const again = await cron({ key: 'cron-secret' }, {});
assert.deepEqual([again.json.results.c1.sent, again.json.results.c1.alreadySent], [0, 3]);
assert.equal((await bell(MGR)).length, 1, 'still one bell message');
assert.equal((await fdb.collection('agentWatchLog').get()).docs.length, 4);
const viaHeader = await cron({}, { authorization: 'Bearer cron-secret' });
assert.equal(viaHeader.status, 200, 'the key also works as a bearer token or x-cron-key header');
assert.equal((await cron({}, { 'x-cron-key': 'cron-secret' })).status, 200);

// the panel: the agent speaks first
const nudge = async (headers: any) => routeAssistant({ method: 'POST', action: 'nudge', query: {}, body: {}, headers });
const seen = async (headers: any, id: string) => routeAssistant({ method: 'POST', action: 'nudge-seen', query: {}, body: { id }, headers });
const m = (await nudge(MGR)).json.nudge;
assert.equal(m.count, 2);
assert.equal(m.sections.length, 2);
assert.match(m.sections[0].lines[0], /Esha Employee/);
assert.equal((await nudge(EMP)).json.nudge, null, 'nothing to say to someone with nothing waiting');
assert.equal((await nudge(HR)).json.nudge.count, 9);
assert.equal((await seen(HR, m.id)).status, 404, 'only the person it was for can dismiss it');
assert.equal((await seen(tokenFor('u_c2', [], 'c2'), m.id)).status, 404, 'and nobody from another company');
assert.equal((await nudge(MGR)).json.nudge.id, m.id, 'still there after a failed dismiss');
assert.equal((await seen(MGR, m.id)).status, 200);
assert.equal((await nudge(MGR)).json.nudge, null, 'dismissed stays dismissed');
assert.equal((await nudge(tokenFor('u_c2', [], 'c2'))).json.nudge.count, 1);
assert.equal((await routeAssistant({ method: 'GET', action: 'nudge', query: {}, body: {}, headers: MGR })).status, 405);

// an old digest is not shown
await fdb.collection('agentWatchLog').doc((await fdb.collection('agentWatchLog').get()).docs.find((d: any) => d.data().uid === 'u_new')!.id).update({ date: addDays(today, -3) });
assert.equal((await nudge(NEW)).json.nudge, null, 'a digest from three days ago is stale');

// tomorrow it can speak again: the one-a-day guard is per day
const tomorrow = await runWatcher('c1', { today: addDays(today, 1) });
assert.equal(tomorrow.sent, 3, 'the same stuck items are raised again on the next day');

// it never changes a record
assert.equal((await leave(HR, 'GET', 'all-requests', {}, { uid: 'u_emp' })).json.items[0].status, 'PENDING');
assert.equal(((await fdb.collection('lifecycleTasks').doc('t1').get()).data() as any).status, 'OPEN');

console.log('agent watcher ok');
